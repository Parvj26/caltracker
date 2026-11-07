-- Plan at invite: "Give them something to start with" in the Invite a client window.
--
-- An invited client has no account (and so no calendar) until they join, so the coach's choice is kept with the
-- invite and put on their calendar when the invite is accepted:
--   client_invite_plan_items   one row per item: a program from a start day, or a single library workout on a day.
--                              Coaches of the workspace can read them (the Clients list shows them on the invite's
--                              row); nobody writes them directly.
--   set_invite_plan()          the only way in: replaces an open invite's plan, for a coach of its workspace.
--   apply_invite_plan()        trigger: when an invite is accepted (accept_invite_for or claim_invites, the two ways
--                              in), copies each item onto the new client's calendar, the same way assign_program and
--                              schedule_workout do, then deletes the items. A day that has passed by then moves to the
--                              day they join (UTC). A failed item is skipped with a warning: joining never fails
--                              because of the plan.
-- Cancelling the invite deletes its plan (on delete cascade), and so does deleting the program or library workout.

create table public.client_invite_plan_items (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.client_invites on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  program_id uuid references public.programs on delete cascade,
  workout_id uuid references public.workouts on delete cascade,
  start_on date not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint client_invite_plan_items_one_kind check ((program_id is null) <> (workout_id is null))
);
create index client_invite_plan_items_invite_idx on public.client_invite_plan_items (invite_id, position);
create index client_invite_plan_items_workspace_idx on public.client_invite_plan_items (workspace_id);
create index client_invite_plan_items_program_idx on public.client_invite_plan_items (program_id);
create index client_invite_plan_items_workout_idx on public.client_invite_plan_items (workout_id);

revoke all on table public.client_invite_plan_items from anon, authenticated, service_role;
grant select on public.client_invite_plan_items to authenticated;
grant select, insert, update, delete on public.client_invite_plan_items to service_role;

alter table public.client_invite_plan_items enable row level security;

create policy client_invite_plan_items_select on public.client_invite_plan_items for select to authenticated
  using (public.is_coach_of(workspace_id));

-- Replaces the plan kept with an open invite: a program (p_program_id from p_start_on), or up to 7 library workouts
-- (p_workout_ids[i] on p_workout_days[i]), or nothing (clears it). Returns how many items are now kept.
-- 42501 unless the caller coaches the invite's workspace and every program and workout is that workspace's own
-- library; 55000 when the invite was already accepted; 22023 for a malformed plan or a day outside yesterday to a
-- year ahead (yesterday: the coach's today can be a day behind UTC's). Locks the invite row, the same lock
-- accept_invite_for and claim_invites take, so a plan is either in place before an accept or refused after it.
create function public.set_invite_plan(
  p_invite_id uuid,
  p_program_id uuid default null,
  p_start_on date default null,
  p_workout_ids uuid[] default '{}',
  p_workout_days date[] default '{}'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inv public.client_invites%rowtype;
  v_ids uuid[] := coalesce(p_workout_ids, '{}');
  v_days date[] := coalesce(p_workout_days, '{}');
  v_count integer;
begin
  select * into inv from public.client_invites i where i.id = p_invite_id for update;
  if not found or not public.is_coach_of(inv.workspace_id) then
    raise exception 'Only a coach of this workspace can plan for its invites' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite was already accepted' using errcode = '55000';
  end if;

  if cardinality(v_ids) <> cardinality(v_days) or cardinality(v_ids) > 7
     or array_position(v_ids, null) is not null or array_position(v_days, null) is not null
     or (p_program_id is not null and (p_start_on is null or cardinality(v_ids) > 0))
     or (p_program_id is null and p_start_on is not null) then
    raise exception 'Pick a program and a start day, or up to 7 workouts with a day each' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(array_append(v_days, p_start_on)) d
    where d is not null and (d < current_date - 1 or d > current_date + 366)
  ) then
    raise exception 'Plan days must be from today to a year ahead' using errcode = '22023';
  end if;
  if p_program_id is not null
     and not exists (select 1 from public.programs p where p.id = p_program_id and p.workspace_id = inv.workspace_id) then
    raise exception 'That program is not in this workspace' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_ids) wid
    where not exists (
      select 1 from public.workouts w where w.id = wid and w.client_id is null and w.workspace_id = inv.workspace_id
    )
  ) then
    raise exception 'That workout is not in this workspace''s library' using errcode = '42501';
  end if;

  delete from public.client_invite_plan_items i where i.invite_id = p_invite_id;
  if p_program_id is not null then
    insert into public.client_invite_plan_items (invite_id, workspace_id, program_id, start_on, position)
    values (p_invite_id, inv.workspace_id, p_program_id, p_start_on, 0);
  else
    insert into public.client_invite_plan_items (invite_id, workspace_id, workout_id, start_on, position)
    select p_invite_id, inv.workspace_id, t.wid, t.d, (t.ord - 1)::smallint
    from unnest(v_ids, v_days) with ordinality as t(wid, d, ord);
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.set_invite_plan(uuid, uuid, date, uuid[], date[]) from public, anon;
grant execute on function public.set_invite_plan(uuid, uuid, date, uuid[], date[]) to authenticated;

-- Puts an accepted invite's plan on the new client's calendar (see the top of this file). The copies are marked as
-- made by the coach who sent the invite (as if they had assigned it), so the workout pickers' Recent and Most used
-- and the program picker's default count them.
create function public.apply_invite_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.client_invite_plan_items%rowtype;
  v_program public.programs%rowtype;
  v_assignment uuid;
  v_copy uuid;
  v_day date;
  v_slot record;
begin
  for v_item in
    select * from public.client_invite_plan_items i where i.invite_id = new.id order by i.position, i.created_at
  loop
    begin
      v_day := greatest(v_item.start_on, current_date);
      if v_item.program_id is not null then
        select * into v_program from public.programs p where p.id = v_item.program_id and p.workspace_id = new.workspace_id;
        if not found then
          continue;
        end if;
        v_assignment := gen_random_uuid();
        insert into public.program_assignments (id, workspace_id, client_id, program_id, program_name, weeks, start_date,
          created_by)
        values (v_assignment, new.workspace_id, new.accepted_by, v_program.id, v_program.name, v_program.weeks, v_day,
          new.created_by);
        for v_slot in
          select pw.workout_id, pw.week, pw.day
          from public.program_workouts pw
          join public.workouts w on w.id = pw.workout_id and w.client_id is null and w.workspace_id = new.workspace_id
          where pw.program_id = v_program.id and pw.week <= v_program.weeks
          order by pw.week, pw.day, pw.position, pw.created_at
        loop
          perform public.copy_workout(v_slot.workout_id, new.accepted_by,
            v_day + ((v_slot.week - 1) * 7 + (v_slot.day - 1)), v_assignment, null);
        end loop;
        perform set_config('caltracker.system_write', 'on', true);
        update public.workouts w set created_by = new.created_by where w.assignment_id = v_assignment;
      else
        if not exists (
          select 1 from public.workouts w
          where w.id = v_item.workout_id and w.client_id is null and w.workspace_id = new.workspace_id
        ) then
          continue;
        end if;
        v_copy := public.copy_workout(v_item.workout_id, new.accepted_by, v_day, null, null);
        perform set_config('caltracker.system_write', 'on', true);
        update public.workouts w set created_by = new.created_by where w.id = v_copy;
      end if;
      -- Back to normal for anything after this item (a failed item's setting is rolled back with it).
      perform set_config('caltracker.system_write', '', true);
    exception when others then
      raise warning 'apply_invite_plan: skipped a plan item of invite % (%)', new.id, sqlstate;
    end;
  end loop;
  delete from public.client_invite_plan_items i where i.invite_id = new.id;
  return null;
end;
$$;
revoke execute on function public.apply_invite_plan() from public, anon, authenticated;

create trigger client_invites_apply_plan
  after update of accepted_at on public.client_invites
  for each row
  when (old.accepted_at is null and new.accepted_at is not null and new.accepted_by is not null)
  execute function public.apply_invite_plan();
