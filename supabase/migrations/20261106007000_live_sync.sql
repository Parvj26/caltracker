-- Program Live Sync (spec: docs/superpowers/specs/2026-11-06-live-sync-design.md).
--
-- A program with live_sync on keeps the calendars of its active assignments in step with the program: from each
-- client's today onwards, workouts that came from the assignment and that nobody has touched are added, replaced or
-- removed to match the program's slots and the library workouts they point at. Past days, workouts with an
-- in-progress or completed log, and copies the coach edited for that one client (customised_at) are never touched.
--
-- How it runs: changes that matter (a slot added, moved or removed; the program's length, name or switch changed; a
-- library workout used by a live program saved) put the program id in program_live_sync_queue. A deferred
-- constraint trigger on that queue syncs each queued program once, at commit, after every write of the transaction
-- (so save_workout's blocks and sets are all in place first), and removes it from the queue. Every save path
-- (set_program_weeks, copy_program_week, duplicate_program, save_workout, plain slot inserts, updates and deletes
-- from the website) is covered without changing those functions, and the sync is part of the same transaction:
-- if it fails, the edit fails too.

-- 1. Columns -------------------------------------------------------------------------------------------------------

-- Off for programs that already exist; on for programs made from now on (including duplicates).
alter table public.programs
  add column live_sync boolean not null default false,
  add column live_synced_at timestamptz,
  add column live_sync_skipped integer not null default 0 check (live_sync_skipped >= 0);
alter table public.programs alter column live_sync set default true;

grant insert (live_sync) on public.programs to authenticated;
grant update (live_sync) on public.programs to authenticated;

-- revision: a library workout's save counter (+1 on every update of the row, which save_workout always stamps).
-- source_revision: on a client copy, the library workout's revision it was copied from, so Live Sync can tell a copy
-- is out of date (null on copies made before Live Sync existed: the catch-up refreshes those).
-- customised_at: when the coach last edited this client copy by hand (saved it in the builder, or moved it to another
-- day). Live Sync leaves customised copies alone.
-- All three are written only by the trigger below and definer functions; authenticated can't write them.
alter table public.workouts
  add column revision integer not null default 0 check (revision >= 0),
  add column source_revision integer,
  add column customised_at timestamptz;

-- 2. Helpers -------------------------------------------------------------------------------------------------------

-- The client's today, in their own time zone (profiles.time_zone). A zone the database doesn't know counts as UTC.
create function public.client_today(p_client uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone text;
begin
  select p.time_zone into v_zone from public.profiles p where p.id = p_client;
  begin
    return (now() at time zone coalesce(v_zone, 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;
  end;
end;
$$;
revoke execute on function public.client_today(uuid) from public, anon, authenticated;

-- Every update of a library workout bumps its revision. An update of a client copy is a coach's hand edit (Live Sync
-- and copy_workout only insert and delete copies), so it marks the copy customised.
create function public.mark_workout_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + case when new.client_id is null then 1 else 0 end;
  new.source_revision := old.source_revision;
  new.customised_at := case
    when new.client_id is not null and coalesce(current_setting('caltracker.live_sync', true), '') <> 'on' then now()
    else old.customised_at
  end;
  return new;
end;
$$;
revoke execute on function public.mark_workout_changed() from public, anon, authenticated;

create trigger workouts_mark_changed before update on public.workouts
  for each row execute function public.mark_workout_changed();

-- copy_workout (from 20261106002100), changed only to record the library workout's revision on the copy.
create or replace function public.copy_workout(p_source uuid, p_client uuid, p_date date, p_assignment uuid, p_new_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_new_id, gen_random_uuid());
  v_old_blocks uuid[];
  v_new_blocks uuid[];
  v_old_exercises uuid[];
  v_new_exercises uuid[];
begin
  if p_client is null or p_date is null then
    raise exception 'A client and a date are required' using errcode = '22004';
  end if;

  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes,
    source_revision)
  select v_id, w.workspace_id, p_client, p_date, p_assignment, w.id, w.name, w.notes, w.revision
  from public.workouts w
  where w.id = p_source and w.client_id is null
  on conflict (id) do nothing;
  if not found then
    if not exists (select 1 from public.workouts w where w.id = p_source and w.client_id is null) then
      raise exception 'Library workout not found' using errcode = 'P0002';
    end if;
    return null; -- p_new_id is already taken
  end if;

  with m as materialized (
    select b.id as old_id, gen_random_uuid() as new_id from public.workout_blocks b where b.workout_id = p_source
  ), ins as (
    insert into public.workout_blocks (id, workout_id, position, kind, section_id, section_name)
    select m.new_id, v_id, b.position, b.kind, b.section_id, b.section_name
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

  return v_id;
end;
$$;

-- 3. The sync ------------------------------------------------------------------------------------------------------

-- Bring every active assignment of a live program in step with it. Internal: called by the queue trigger only.
-- Per assignment (still a current client; not ended before the client's today; not cancelled on or before it):
--   window   = the client's today (or the start date, if later) up to the day before cancelled_on, if any;
--   wanted   = each slot inside the program's length, on start_date + (week - 1) * 7 + (day - 1), inside the window;
--   existing = the assignment's workouts inside the window.
-- They are paired by (date, library workout, n-th of that pair), protected copies first. Protected = a log in
-- progress or completed, or customised by the coach. Then:
--   wanted with no copy            -> copy the library workout in;
--   copy with no wanted slot       -> delete it, unless protected;
--   paired, copy out of date       -> replace it (same id, fresh content), unless protected.
-- The assignment's snapshot name and length follow the program. packages/shared planLiveSync mirrors this.
-- Returns the number of customised copies left as they were although the program differs (shown to the coach).
create function public.live_sync_program(p_program_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_program public.programs%rowtype;
  v_assignment record;
  v_from date;
  v_until date;
  v_row record;
  v_skipped integer := 0;
begin
  select * into v_program from public.programs p where p.id = p_program_id;
  if not found or not v_program.live_sync then
    return 0;
  end if;

  perform set_config('caltracker.live_sync', 'on', true);

  for v_assignment in
    select a.id, a.client_id, a.start_date, a.end_date, a.cancelled_on, public.client_today(a.client_id) as today
    from public.program_assignments a
    where a.program_id = p_program_id
      and a.workspace_id = v_program.workspace_id
      and exists (
        select 1 from public.workspace_members m
        where m.workspace_id = a.workspace_id and m.user_id = a.client_id and m.role = 'client'
      )
    for update of a
  loop
    continue when v_assignment.end_date < v_assignment.today
      or v_assignment.cancelled_on <= v_assignment.today;

    v_from := greatest(v_assignment.start_date, v_assignment.today);
    v_until := coalesce(v_assignment.cancelled_on - 1, 'infinity'::date);

    update public.program_assignments a set program_name = v_program.name, weeks = v_program.weeks
    where a.id = v_assignment.id and (a.program_name, a.weeks) is distinct from (v_program.name, v_program.weeks);

    for v_row in
      with wanted as (
        select w.id as source, w.revision as source_rev,
          v_assignment.start_date + ((pw.week - 1) * 7 + (pw.day - 1)) as on_date,
          row_number() over (
            partition by v_assignment.start_date + ((pw.week - 1) * 7 + (pw.day - 1)), w.id
            order by pw.position, pw.created_at, pw.id
          ) as n
        from public.program_workouts pw
        join public.workouts w on w.id = pw.workout_id and w.client_id is null and w.workspace_id = v_program.workspace_id
        where pw.program_id = p_program_id and pw.week <= v_program.weeks
      ), copies as (
        select c.id, c.scheduled_on as on_date, c.source_workout_id as source, c.source_revision as copy_rev,
          c.customised_at is not null as customised,
          exists (
            select 1 from public.workout_logs l
            where l.workout_id = c.id and l.status in ('in_progress', 'completed')
          ) as logged
        from public.workouts c
        where c.assignment_id = v_assignment.id and c.scheduled_on between v_from and v_until
      ), ranked as (
        select c.*, row_number() over (
          partition by c.on_date, c.source order by (c.customised or c.logged) desc, c.id
        ) as n
        from copies c
      )
      select r.id as copy_id, r.customised, r.logged, r.copy_rev,
        coalesce(r.on_date, x.on_date) as on_date, x.source, x.source_rev
      from ranked r
      full join (select * from wanted where on_date between v_from and v_until) x
        on x.on_date = r.on_date and x.source = r.source and x.n = r.n
      order by coalesce(r.on_date, x.on_date)
    loop
      if v_row.copy_id is null then
        perform public.copy_workout(v_row.source, v_assignment.client_id, v_row.on_date, v_assignment.id, null);
      elsif v_row.source is null or v_row.copy_rev is distinct from v_row.source_rev then
        if v_row.logged then
          null; -- the client has started or finished it: it stays as they saw it
        elsif v_row.customised then
          v_skipped := v_skipped + 1;
        else
          delete from public.workouts w where w.id = v_row.copy_id;
          if v_row.source is not null then
            perform public.copy_workout(v_row.source, v_assignment.client_id, v_row.on_date, v_assignment.id,
              v_row.copy_id);
          end if;
        end if;
      end if;
    end loop;
  end loop;

  update public.programs p set live_synced_at = now(), live_sync_skipped = v_skipped where p.id = p_program_id;
  perform set_config('caltracker.live_sync', '', true);
  return v_skipped;
end;
$$;
revoke execute on function public.live_sync_program(uuid) from public, anon, authenticated;

-- 4. The queue -----------------------------------------------------------------------------------------------------

-- Programs waiting to sync at the end of the current transaction. A row lives only inside one transaction: it is
-- removed when its program syncs, before commit, so nobody ever sees one. Nobody signed in can read or write it.
create table public.program_live_sync_queue (
  program_id uuid primary key
);
revoke all on table public.program_live_sync_queue from public, anon, authenticated, service_role;
alter table public.program_live_sync_queue enable row level security;
-- No policies: definer functions below are the only writers.

create function public.queue_live_sync(p_program_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.program_live_sync_queue (program_id)
  select p.id from public.programs p where p.id = p_program_id and p.live_sync
  on conflict (program_id) do nothing;
$$;
revoke execute on function public.queue_live_sync(uuid) from public, anon, authenticated;

create function public.run_queued_live_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Gone already when an earlier firing in this transaction synced it (SET CONSTRAINTS ... IMMEDIATE, or tests).
  delete from public.program_live_sync_queue q where q.program_id = new.program_id;
  if found then
    perform public.live_sync_program(new.program_id);
  end if;
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
  from (select distinct pw.program_id from public.program_workouts pw where pw.workout_id = new.id) x;
  return null;
end;
$$;
revoke execute on function public.live_sync_on_library_change() from public, anon, authenticated;

-- save_workout always stamps the workout row (before writing its blocks; the sync itself waits for commit).
create trigger workouts_live_sync after update on public.workouts
  for each row when (new.client_id is null)
  execute function public.live_sync_on_library_change();
