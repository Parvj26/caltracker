-- Program Live Sync (spec: docs/superpowers/specs/2026-11-06-live-sync-design.md).
--
-- A program with live_sync on keeps the calendars of its active assignments in step with the program. From each
-- client's today on, Live Sync adds workouts the program has and the client's calendar lacks; from tomorrow on, it
-- also refreshes and removes workouts nobody has touched. It never touches past days, today's existing workouts,
-- workouts with an in-progress or completed log, copies the coach edited for that one client (customised_at), or a
-- program day the coach deleted from that client's calendar (live_sync_tombstones).
--
-- How it runs: changes that matter (a slot added, moved or removed; the program's length, name or switch changed; a
-- library workout used by a live program saved or deleted) put the program id in program_live_sync_queue. A deferred
-- constraint trigger on that queue syncs every queued program, in program id order, at commit, after every write of
-- the transaction (so save_workout's blocks and sets are all in place first). Every save path is covered without
-- changing those functions, and the sync is part of the same transaction: if it fails, the edit fails too.
--
-- System writes (copy_workout and the sync itself) run with the transaction setting caltracker.system_write = 'on',
-- so the triggers below can tell them from a coach's hand edits.

-- 1. Columns -------------------------------------------------------------------------------------------------------

-- Off for programs that already exist; on for programs made from now on (including duplicates).
alter table public.programs
  add column live_sync boolean not null default false,
  add column live_synced_at timestamptz,
  add column live_sync_skipped integer not null default 0 check (live_sync_skipped >= 0);
alter table public.programs alter column live_sync set default true;

grant insert (live_sync) on public.programs to authenticated;
grant update (live_sync) on public.programs to authenticated;

-- On a client copy that came from a program:
--   planned_on: the program day it was copied for. Moving the copy changes scheduled_on, never planned_on, so Live
--     Sync pairs copies with program days by planned_on and a moved copy still stands for its day.
--   source_hash: workout_content_hash of the library workout when the copy was made, so Live Sync can tell a copy is
--     out of date (null on copies made before Live Sync: the catch-up refreshes untouched ones).
--   customised_at: when the coach last edited this copy by hand (name, notes or day changed, or a block, exercise,
--     set or substitute written). Live Sync leaves customised copies alone.
-- All three are written only by triggers and definer functions; authenticated can't write them.
alter table public.workouts
  add column planned_on date,
  add column source_hash text,
  add column customised_at timestamptz;

-- Existing program copies are filled in by live_sync_backfill_copies() at the end of this migration.

-- 2. Helpers -------------------------------------------------------------------------------------------------------

create function public.is_system_write() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('caltracker.system_write', true), '') = 'on';
$$;
-- Read by triggers that run as the signed-in coach (it only reads a setting of the current transaction, which the
-- API can't set).
revoke execute on function public.is_system_write() from public, anon;
grant execute on function public.is_system_write() to authenticated;

-- The time zone Live Sync uses for a client: their own (profiles.time_zone) when set, else the workspace's coach's
-- (owner first). 'UTC' is the column's default, so it counts as not set. Null when neither is set or known.
create function public.client_zone(p_client uuid, p_workspace uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone text;
begin
  for v_zone in
    select z.zone
    from (
      select p.time_zone as zone, 0 as rank from public.profiles p where p.id = p_client
      union all
      select p.time_zone, case when m.role = 'owner' then 1 else 2 end
      from public.workspace_members m join public.profiles p on p.id = m.user_id
      where m.workspace_id = p_workspace and m.role in ('owner', 'staff')
    ) z
    where z.zone is not null and z.zone <> 'UTC'
    order by z.rank
  loop
    begin
      perform now() at time zone v_zone; -- an unknown zone raises; try the next one
      return v_zone;
    exception when others then
      null;
    end;
  end loop;
  return null;
end;
$$;
revoke execute on function public.client_zone(uuid, uuid) from public, anon, authenticated;

-- The client's today in that zone. With no zone known, the day after UTC's today: that is the latest date that can
-- be today anywhere, so Live Sync never changes a day that might be the client's today.
create function public.client_today(p_client uuid, p_workspace uuid) returns date
language sql stable security definer set search_path = '' as $$
  select coalesce((now() at time zone public.client_zone(p_client, p_workspace))::date,
    (now() at time zone 'UTC')::date + 1);
$$;
revoke execute on function public.client_today(uuid, uuid) from public, anon, authenticated;

-- A fingerprint of everything a client sees of a workout: name, notes and the ordered blocks, exercises, sets and
-- substitutes (no ids or timestamps). Equal hashes mean equal content, so a save that changes nothing changes
-- nothing on clients' calendars.
create function public.workout_content_hash(p_workout uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_array(w.name, w.notes, (
    select coalesce(jsonb_agg(jsonb_build_array(b.position, b.kind, b.section_id, b.section_name, (
      select coalesce(jsonb_agg(jsonb_build_array(e.position, e.exercise_id, e.note, (
        select coalesce(jsonb_agg(jsonb_build_array(s.position, s.set_type, s.target_reps_min, s.target_reps_max,
          s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note)
          order by s.position), '[]'::jsonb)
        from public.workout_sets s where s.workout_exercise_id = e.id
      ), (
        select coalesce(jsonb_agg(jsonb_build_array(x.position, x.exercise_id, x.note, x.sets) order by x.position),
          '[]'::jsonb)
        from public.workout_substitutes x where x.workout_exercise_id = e.id
      )) order by e.position), '[]'::jsonb)
      from public.workout_exercises e where e.block_id = b.id
    )) order by b.position), '[]'::jsonb)
    from public.workout_blocks b where b.workout_id = w.id
  ))::text)
  from public.workouts w where w.id = p_workout;
$$;
revoke execute on function public.workout_content_hash(uuid) from public, anon, authenticated;

-- 3. Customised copies ---------------------------------------------------------------------------------------------

-- A client copy's tracking columns: planned_on and source_hash change only in system writes; a hand edit
-- of name, notes or day marks it customised (an update that only changes links, such as source_workout_id set null
-- when the library workout is deleted, does not). The child-table trigger below sets customised_at directly.
create function public.mark_workout_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.client_id is null then
    return new;
  end if;
  if public.is_system_write() then
    return new; -- copy_workout, the sync and the backfill set these columns themselves
  end if;
  new.planned_on := old.planned_on;
  new.source_hash := old.source_hash;
  if (new.name, new.notes, new.scheduled_on) is distinct from (old.name, old.notes, old.scheduled_on) then
    new.customised_at := now();
  else
    new.customised_at := coalesce(new.customised_at, old.customised_at);
  end if;
  return new;
end;
$$;
revoke execute on function public.mark_workout_changed() from public, anon, authenticated;

create trigger workouts_mark_changed before update on public.workouts
  for each row execute function public.mark_workout_changed();

-- A block, exercise, set or substitute of a program copy written outside a system write: the coach edited the copy.
create function public.mark_parent_customised() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workout uuid := case when tg_op = 'DELETE' then old.workout_id else new.workout_id end;
  v_client uuid := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
begin
  -- Library rows (no client) and system writes don't count.
  if v_client is null or public.is_system_write() then
    return null;
  end if;
  update public.workouts w set customised_at = now()
  where w.id = v_workout and w.client_id is not null and w.assignment_id is not null
    and w.customised_at is distinct from now();
  return null;
end;
$$;
revoke execute on function public.mark_parent_customised() from public, anon, authenticated;

create trigger workout_blocks_mark_customised after insert or update or delete on public.workout_blocks
  for each row execute function public.mark_parent_customised();
create trigger workout_exercises_mark_customised after insert or update or delete on public.workout_exercises
  for each row execute function public.mark_parent_customised();
create trigger workout_sets_mark_customised after insert or update or delete on public.workout_sets
  for each row execute function public.mark_parent_customised();
create trigger workout_substitutes_mark_customised after insert or update or delete on public.workout_substitutes
  for each row execute function public.mark_parent_customised();

-- 4. Tombstones ----------------------------------------------------------------------------------------------------

-- A program day the coach deleted from a client's calendar: Live Sync doesn't add that workout back on that day.
-- Written by a trigger when a program copy is deleted outside a system write (the coach's "Delete", or "Remove from
-- calendar"). Removed with the assignment.
-- source_workout_id has no foreign key on purpose: with keys to both program_assignments and workouts, the API would
-- see this table as a link between them and could no longer tell which way workouts embed program_assignments. A
-- tombstone of a deleted library workout is never matched again, and goes with its assignment.
create table public.live_sync_tombstones (
  assignment_id uuid not null references public.program_assignments on delete cascade,
  planned_on date not null,
  source_workout_id uuid not null,
  workspace_id uuid not null references public.workspaces on delete cascade,
  created_at timestamptz not null default now(),
  primary key (assignment_id, planned_on, source_workout_id)
);
create index live_sync_tombstones_workspace_idx on public.live_sync_tombstones (workspace_id);

revoke all on table public.live_sync_tombstones from public, anon, authenticated, service_role;
grant select on public.live_sync_tombstones to authenticated;
grant select, insert, update, delete on public.live_sync_tombstones to service_role;
alter table public.live_sync_tombstones enable row level security;
-- Coaches of the workspace can read them; clients and other workspaces see nothing. Nobody signed in writes them.
create policy live_sync_tombstones_select on public.live_sync_tombstones for select to authenticated
  using (public.is_coach_of(workspace_id));

create function public.record_live_sync_tombstone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.is_system_write() then
    return null;
  end if;
  insert into public.live_sync_tombstones (assignment_id, planned_on, source_workout_id, workspace_id)
  select a.id, old.planned_on, old.source_workout_id, a.workspace_id
  from public.program_assignments a
  where a.id = old.assignment_id
    and exists (select 1 from public.workouts w where w.id = old.source_workout_id)
  on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.record_live_sync_tombstone() from public, anon, authenticated;

create trigger workouts_live_sync_tombstone after delete on public.workouts
  for each row when (old.assignment_id is not null and old.planned_on is not null and old.source_workout_id is not null)
  execute function public.record_live_sync_tombstone();

-- 5. Copying -------------------------------------------------------------------------------------------------------

-- Deep-copy a library workout's blocks, exercises, substitutes and sets (fresh ids, same positions and targets) into
-- p_target. Internal: callers authorize and set caltracker.system_write.
create function public.copy_workout_children(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old_blocks uuid[];
  v_new_blocks uuid[];
  v_old_exercises uuid[];
  v_new_exercises uuid[];
begin
  with m as materialized (
    select b.id as old_id, gen_random_uuid() as new_id from public.workout_blocks b where b.workout_id = p_source
  ), ins as (
    insert into public.workout_blocks (id, workout_id, position, kind, section_id, section_name)
    select m.new_id, p_target, b.position, b.kind, b.section_id, b.section_name
    from m join public.workout_blocks b on b.id = m.old_id
  )
  select coalesce(array_agg(m.old_id), '{}'), coalesce(array_agg(m.new_id), '{}')
  into v_old_blocks, v_new_blocks from m;

  with bm as (
    select * from unnest(v_old_blocks, v_new_blocks) as t(old_id, new_id)
  ), m as materialized (
    select e.id as old_id, gen_random_uuid() as new_id, bm.new_id as new_block_id
    from public.workout_exercises e join bm on bm.old_id = e.block_id
  ), ins as (
    insert into public.workout_exercises (id, block_id, position, exercise_id, note)
    select m.new_id, m.new_block_id, e.position, e.exercise_id, e.note
    from m join public.workout_exercises e on e.id = m.old_id
  )
  select coalesce(array_agg(m.old_id), '{}'), coalesce(array_agg(m.new_id), '{}')
  into v_old_exercises, v_new_exercises from m;

  -- Substitutes, with new ids for their sets too.
  insert into public.workout_substitutes (id, workout_exercise_id, position, exercise_id, note, sets)
  select gen_random_uuid(), em.new_id, ws.position, ws.exercise_id, ws.note,
    (select jsonb_agg(jsonb_set(x.value, '{id}', to_jsonb(gen_random_uuid())) order by x.ordinality)
       from jsonb_array_elements(ws.sets) with ordinality x)
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_substitutes ws on ws.workout_exercise_id = em.old_id;

  insert into public.workout_sets (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds, note)
  select gen_random_uuid(), em.new_id, s.position, s.set_type, s.target_reps_min, s.target_reps_max,
    s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_sets s on s.workout_exercise_id = em.old_id;
end;
$$;
revoke execute on function public.copy_workout_children(uuid, uuid) from public, anon, authenticated;

-- copy_workout (from 20261106002100): the children now come from copy_workout_children, and a copy records the
-- program day it was made for (planned_on, assignments only) and the library content it was made from (source_hash).
-- Runs as a system write, so the copy doesn't count as customised.
create or replace function public.copy_workout(p_source uuid, p_client uuid, p_date date, p_assignment uuid, p_new_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_new_id, gen_random_uuid());
  v_prev text := coalesce(current_setting('caltracker.system_write', true), '');
begin
  if p_client is null or p_date is null then
    raise exception 'A client and a date are required' using errcode = '22004';
  end if;
  perform set_config('caltracker.system_write', 'on', true);

  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes,
    planned_on, source_hash)
  select v_id, w.workspace_id, p_client, p_date, p_assignment, w.id, w.name, w.notes,
    case when p_assignment is not null then p_date end, public.workout_content_hash(w.id)
  from public.workouts w
  where w.id = p_source and w.client_id is null
  on conflict (id) do nothing;
  if not found then
    perform set_config('caltracker.system_write', v_prev, true);
    if not exists (select 1 from public.workouts w where w.id = p_source and w.client_id is null) then
      raise exception 'Library workout not found' using errcode = 'P0002';
    end if;
    return null; -- p_new_id is already taken
  end if;

  perform public.copy_workout_children(p_source, v_id);
  perform set_config('caltracker.system_write', v_prev, true);
  return v_id;
end;
$$;

-- 6. The sync ------------------------------------------------------------------------------------------------------

-- Bring every active assignment of a live program in step with it. Internal: called by the queue trigger only.
-- Per assignment (still a current client; not ended before the client's today; not cancelled on or before it),
-- locked in id order:
--   window   = the client's today (or the start date, if later) up to the day before cancelled_on, if any;
--   wanted   = each slot inside the program's length, on start_date + (week - 1) * 7 + (day - 1), inside the window;
--   copies   = the assignment's workouts whose program day (planned_on) is inside the window.
-- They are paired by (program day, library workout, n-th of that pair), protected copies first. Protected = a log in
-- progress or completed, or customised. Then:
--   wanted with no copy             -> copy the library workout in, unless the coach deleted that day's copy
--                                      (tombstone) or that day has a started or done copy the program no longer has;
--   copy with no wanted slot        -> delete it, if unprotected and both its days are after today;
--   paired, library content changed -> refresh it in place (same row and id, new blocks), if unprotected and both its
--                                      days are after today.
-- Customised copies that differ from the program (and are after today) are counted as skipped. The assignment's
-- snapshot name and length follow the program. packages/shared planLiveSync mirrors this.
-- Before deleting or refreshing a copy it is locked and checked again for a log, so a log saved meanwhile wins.
create function public.live_sync_program(p_program_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_program public.programs%rowtype;
  v_assignment record;
  v_from date;
  v_until date;
  v_row record;
  v_skipped integer := 0;
  v_prev text := coalesce(current_setting('caltracker.system_write', true), '');
begin
  select * into v_program from public.programs p where p.id = p_program_id;
  if not found or not v_program.live_sync then
    return 0;
  end if;

  perform set_config('caltracker.system_write', 'on', true);

  for v_assignment in
    select a.id, a.client_id, a.start_date, a.end_date, a.cancelled_on,
      public.client_today(a.client_id, a.workspace_id) as today,
      coalesce(public.client_zone(a.client_id, a.workspace_id), 'UTC') as zone
    from public.program_assignments a
    where a.program_id = p_program_id
      and a.workspace_id = v_program.workspace_id
      and exists (
        select 1 from public.workspace_members m
        where m.workspace_id = a.workspace_id and m.user_id = a.client_id and m.role = 'client'
      )
    order by a.id
    for update of a
  loop
    continue when v_assignment.end_date < v_assignment.today
      or v_assignment.cancelled_on <= v_assignment.today;

    v_from := greatest(v_assignment.start_date, v_assignment.today);
    v_until := coalesce(v_assignment.cancelled_on - 1, 'infinity'::date);

    update public.program_assignments a set program_name = v_program.name, weeks = v_program.weeks
    where a.id = v_assignment.id and (a.program_name, a.weeks) is distinct from (v_program.name, v_program.weeks);

    for v_row in
      with lib as materialized (
        select x.id, public.workout_content_hash(x.id) as hash
        from (
          select distinct w.id
          from public.program_workouts pw
          join public.workouts w on w.id = pw.workout_id and w.client_id is null
            and w.workspace_id = v_program.workspace_id
          where pw.program_id = p_program_id and pw.week <= v_program.weeks
        ) x
      ), wanted as (
        select pw.workout_id as source, l.hash,
          v_assignment.start_date + ((pw.week - 1) * 7 + (pw.day - 1)) as on_date,
          row_number() over (
            partition by v_assignment.start_date + ((pw.week - 1) * 7 + (pw.day - 1)), pw.workout_id
            order by pw.position, pw.created_at, pw.id
          ) as n
        from public.program_workouts pw
        join lib l on l.id = pw.workout_id
        where pw.program_id = p_program_id and pw.week <= v_program.weeks
      ), copies as (
        select c.id, c.planned_on as on_date, c.scheduled_on, c.source_workout_id as source, c.source_hash,
          c.customised_at is not null as customised,
          exists (
            select 1 from public.workout_logs l
            where l.workout_id = c.id and l.status in ('in_progress', 'completed')
          ) as logged
        from public.workouts c
        where c.assignment_id = v_assignment.id and c.planned_on between v_from and v_until
      ), ranked as (
        select c.*, row_number() over (
          partition by c.on_date, c.source order by (c.customised or c.logged) desc, c.id
        ) as n
        from copies c
      ), joined as (
        select r.id as copy_id, r.scheduled_on, r.customised, r.logged, r.source_hash as copy_hash,
          x.source as want_source, x.hash as want_hash, coalesce(r.on_date, x.on_date) as day
        from ranked r
        full join (select * from wanted where on_date between v_from and v_until) x
          on x.on_date = r.on_date and x.source = r.source and x.n = r.n
      )
      select j.*,
        -- A day the client has already worked out: a started or done copy the program no longer has (by its program
        -- day), any started or done copy of this assignment on that day, or any started or done log of the client
        -- (planned or not) dated that day in their zone.
        bool_or(coalesce(j.logged, false) and j.want_source is null) over (partition by j.day)
          or exists (
            select 1 from public.workout_logs l
            left join public.workouts c on c.id = l.workout_id
            where l.client_id = v_assignment.client_id and l.status in ('in_progress', 'completed')
              and ((c.assignment_id = v_assignment.id and c.scheduled_on = j.day)
                or (coalesce(l.finished_at, l.started_at) at time zone v_assignment.zone)::date = j.day)
          ) as day_has_dropped_log,
        exists (
          select 1 from public.live_sync_tombstones t
          where t.assignment_id = v_assignment.id and t.planned_on = j.day and t.source_workout_id = j.want_source
        ) as tombstoned
      from joined j
      order by j.day, j.copy_id
    loop
      if v_row.copy_id is null then
        -- A program day to fill: not when the coach deleted it, or the client already worked out that day.
        if not v_row.tombstoned and not v_row.day_has_dropped_log then
          perform public.copy_workout(v_row.want_source, v_assignment.client_id, v_row.day, v_assignment.id, null);
        end if;
      elsif v_row.want_source is null or v_row.copy_hash is distinct from v_row.want_hash then
        if v_row.logged or v_row.day <= v_assignment.today or v_row.scheduled_on <= v_assignment.today then
          null; -- started or done, or today: it stays as the client has it
        elsif v_row.customised then
          v_skipped := v_skipped + 1;
        else
          -- Lock the copy (a log being saved for it waits, or has committed), then check again in a new statement.
          perform 1 from public.workouts w where w.id = v_row.copy_id for update;
          if not exists (
            select 1 from public.workout_logs l
            where l.workout_id = v_row.copy_id and l.status in ('in_progress', 'completed')
          ) then
            if v_row.want_source is null then
              delete from public.workouts w where w.id = v_row.copy_id;
            else
              -- Refresh in place: the row (and anything linked to it) stays; its content is replaced.
              delete from public.workout_blocks b where b.workout_id = v_row.copy_id;
              update public.workouts w set name = s.name, notes = s.notes, source_hash = v_row.want_hash
              from public.workouts s
              where w.id = v_row.copy_id and s.id = v_row.want_source;
              perform public.copy_workout_children(v_row.want_source, v_row.copy_id);
            end if;
          end if;
        end if;
      end if;
    end loop;
  end loop;

  update public.programs p set live_synced_at = now(), live_sync_skipped = v_skipped where p.id = p_program_id;
  perform set_config('caltracker.system_write', v_prev, true);
  return v_skipped;
end;
$$;
revoke execute on function public.live_sync_program(uuid) from public, anon, authenticated;

-- 7. The queue -----------------------------------------------------------------------------------------------------

-- Programs waiting to sync at the end of the current transaction. A row lives only inside one transaction: it is
-- removed when its program syncs, before commit, so nobody ever sees one. Nobody signed in can read or write it.
-- Keyed by transaction too, so two transactions queueing the same programs never wait on each other here (no
-- deadlock between their queue inserts); they meet only in the sync, which locks in program, then assignment, order.
create table public.program_live_sync_queue (
  xact xid8 not null default pg_catalog.pg_current_xact_id(),
  program_id uuid not null,
  primary key (xact, program_id)
);
revoke all on table public.program_live_sync_queue from public, anon, authenticated, service_role;
alter table public.program_live_sync_queue enable row level security;
-- No policies: definer functions below are the only writers.

create function public.queue_live_sync(p_program_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.program_live_sync_queue (program_id)
  select p.id from public.programs p where p.id = p_program_id and p.live_sync
  on conflict (xact, program_id) do nothing;
$$;
revoke execute on function public.queue_live_sync(uuid) from public, anon, authenticated;

-- The first firing at commit syncs everything this transaction queued, in program id order (a steady lock order
-- between transactions); later firings find nothing left.
create function public.run_queued_live_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_program uuid;
begin
  for v_program in
    select q.program_id from public.program_live_sync_queue q
    where q.xact = pg_catalog.pg_current_xact_id()
    order by q.program_id
  loop
    delete from public.program_live_sync_queue q
    where q.xact = pg_catalog.pg_current_xact_id() and q.program_id = v_program;
    perform public.live_sync_program(v_program);
  end loop;
  return null;
end;
$$;
revoke execute on function public.run_queued_live_sync() from public, anon, authenticated;

create constraint trigger program_live_sync_queue_run after insert on public.program_live_sync_queue
  deferrable initially deferred
  for each row execute function public.run_queued_live_sync();

-- What queues a sync.
create function public.live_sync_on_slot_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.queue_live_sync(old.program_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.queue_live_sync(new.program_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.live_sync_on_slot_change() from public, anon, authenticated;

-- Deleting a library workout deletes its slots too (on delete cascade), so that queues its live programs.
create trigger program_workouts_live_sync after insert or update or delete on public.program_workouts
  for each row execute function public.live_sync_on_slot_change();

create function public.live_sync_on_program_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.queue_live_sync(new.id);
  return null;
end;
$$;
revoke execute on function public.live_sync_on_program_change() from public, anon, authenticated;

-- Turning it on runs the catch-up sync; a new length or name reaches the clients too.
create trigger programs_live_sync after update of weeks, name, live_sync on public.programs
  for each row when (new.live_sync and (old.weeks, old.name, old.live_sync) is distinct from (new.weeks, new.name, new.live_sync))
  execute function public.live_sync_on_program_change();

create function public.live_sync_on_library_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.queue_live_sync(x.program_id)
  from (select distinct pw.program_id from public.program_workouts pw where pw.workout_id = new.id order by 1) x;
  return null;
end;
$$;
revoke execute on function public.live_sync_on_library_change() from public, anon, authenticated;

-- save_workout always stamps the library workout row (before writing its blocks; the sync waits for commit). The sync
-- compares content hashes, so a save that changes nothing changes nothing for clients.
create trigger workouts_live_sync after update on public.workouts
  for each row when (new.client_id is null)
  execute function public.live_sync_on_library_change();

-- 8. Copies made before Live Sync ----------------------------------------------------------------------------------

-- Fill planned_on and source_hash on program copies that predate Live Sync (planned_on is null). Their history isn't
-- known, so a copy counts as untouched only when both
--   (a) its content equals its library workout's content now (then source_hash is that), and
--   (b) its day is a slot day of its library workout in the assigned program;
-- otherwise it is marked customised, and Live Sync leaves it alone. planned_on is its current day when that is a slot
-- day; for a copy moved off its slot day it is the nearest slot day of its workout that has no copy of it (the day it
-- most likely left), so the program day isn't filled twice.
-- Internal; run once below (and by tests).
create function public.live_sync_backfill_copies() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_prev text := coalesce(current_setting('caltracker.system_write', true), '');
  v_count integer;
begin
  perform set_config('caltracker.system_write', 'on', true);
  with old as (
    select c.id, c.scheduled_on,
      case when c.source_workout_id is not null then public.workout_content_hash(c.source_workout_id) end as lib_hash,
      public.workout_content_hash(c.id) as own_hash,
      exists (
        select 1 from public.program_assignments a
        join public.program_workouts pw on pw.program_id = a.program_id and pw.workout_id = c.source_workout_id
        where a.id = c.assignment_id
          and a.start_date + ((pw.week - 1) * 7 + (pw.day - 1)) = c.scheduled_on
      ) as on_slot_day
    from public.workouts c
    where c.assignment_id is not null and c.client_id is not null and c.planned_on is null
  )
  update public.workouts w
  set planned_on = case when o.on_slot_day then o.scheduled_on else coalesce((
      select x.day from (
        select a.start_date + ((pw.week - 1) * 7 + (pw.day - 1)) as day
        from public.program_assignments a
        join public.program_workouts pw on pw.program_id = a.program_id and pw.workout_id = w.source_workout_id
        where a.id = w.assignment_id and pw.week <= a.weeks
      ) x
      where not exists (
        select 1 from public.workouts o2
        where o2.assignment_id = w.assignment_id and o2.source_workout_id = w.source_workout_id and o2.scheduled_on = x.day
      )
      order by abs(x.day - o.scheduled_on), x.day
      limit 1), o.scheduled_on) end,
    source_hash = case when o.own_hash = o.lib_hash and o.on_slot_day then o.lib_hash end,
    customised_at = case when o.own_hash = o.lib_hash and o.on_slot_day then w.customised_at
      else coalesce(w.customised_at, now()) end
  from old o
  where w.id = o.id;
  get diagnostics v_count = row_count;
  perform set_config('caltracker.system_write', v_prev, true);
  return v_count;
end;
$$;
revoke execute on function public.live_sync_backfill_copies() from public, anon, authenticated;

alter table public.workouts disable trigger workouts_touch_updated_at;
select public.live_sync_backfill_copies();
alter table public.workouts enable trigger workouts_touch_updated_at;
