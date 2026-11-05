-- Assignment (phase 2). A coach assigns a program (or one library workout) to a client from a start date. The
-- database deep-copies the library workouts into the client's calendar, so later template edits (or deleting the
-- template or the program) never change the client's copies, and editing a copy never changes the template.
--
-- program_assignments records which program was assigned, with its name and length snapshotted. It is written only
-- by the security definer functions below; clients and coaches can read it.
-- Slot (week w, day d) lands on start_date + (w - 1) * 7 + (d - 1), the same as programDayToDate in packages/shared.

create table public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  client_id uuid not null references auth.users on delete cascade,
  -- Deleting the program keeps the assignment (and the client's workouts); the name and weeks stay snapshotted.
  program_id uuid references public.programs on delete set null,
  program_name text not null check (char_length(program_name) between 1 and 100),
  weeks smallint not null check (weeks between 1 and 52),
  start_date date not null,
  end_date date generated always as (start_date + (weeks * 7 - 1)) stored,
  cancelled_on date,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index program_assignments_workspace_id_idx on public.program_assignments (workspace_id);
create index program_assignments_client_idx on public.program_assignments (client_id, start_date);
create index program_assignments_program_id_idx on public.program_assignments (program_id);

alter table public.workouts
  add constraint workouts_assignment_id_fkey foreign key (assignment_id)
  references public.program_assignments on delete set null;
create index workouts_assignment_id_idx on public.workouts (assignment_id);

create trigger program_assignments_touch_updated_at before update on public.program_assignments
  for each row execute function public.touch_updated_at();

-- Privileges: read-only for signed-in users, nothing for anon. Writes happen only through the functions below.
revoke all on table public.program_assignments from anon, authenticated, service_role;
grant select on public.program_assignments to authenticated;
grant select, insert, update, delete on public.program_assignments to service_role;

alter table public.program_assignments enable row level security;

-- Coaches see every assignment of their workspace (including removed clients'); a client sees their own, and only
-- while still a client of that workspace.
create policy program_assignments_select on public.program_assignments for select to authenticated
  using (public.is_coach_of(workspace_id)
    or (client_id = (select auth.uid()) and public.is_client_in(workspace_id, client_id)));

-- Internal: deep-copy one library workout (blocks, exercises, sets: fresh ids, same positions and targets) onto
-- p_client's calendar on p_date as an instance with source_workout_id = p_source. Called only by assign_program
-- and schedule_workout, which check authorization first; nobody signed in can execute it directly.
-- Set-based: each level builds an old -> new id map (gen_random_uuid() in a materialized CTE) and inserts the
-- children joined to the parent level's map. Children go in by INSERT under their new parent, so
-- inherit_workout_owner fills workout_id, workspace_id and client_id from the copy, never from the template.
-- Returns the new workout id, or null when p_new_id already exists (the caller decides what that means).
create function public.copy_workout(p_source uuid, p_client uuid, p_date date, p_assignment uuid, p_new_id uuid)
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

  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes)
  select v_id, w.workspace_id, p_client, p_date, p_assignment, w.id, w.name, w.notes
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
    insert into public.workout_blocks (id, workout_id, position, kind)
    select m.new_id, v_id, b.position, b.kind
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

  insert into public.workout_sets (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, target_duration_s, target_distance_m, to_failure, rest_seconds, note)
  select gen_random_uuid(), em.new_id, s.position, s.set_type, s.target_reps_min, s.target_reps_max,
    s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note
  from unnest(v_old_exercises, v_new_exercises) as em(old_id, new_id)
  join public.workout_sets s on s.workout_exercise_id = em.old_id;

  return v_id;
end;
$$;
revoke execute on function public.copy_workout(uuid, uuid, date, uuid, uuid) from public, anon, authenticated;

-- Assign a program to a client from p_start_date. p_assignment_id is generated by the app, so a double click or
-- a network retry sends the same id: an existing assignment with the same client, program and start date returns
-- the id without copying again; the same id with different arguments raises 23505.
-- Raises 42501 unless the caller coaches the program's workspace and p_client_id is a current client of it.
-- Only slots inside the program's length (week <= weeks) are copied, so every copy falls between start and end date.
create function public.assign_program(p_assignment_id uuid, p_program_id uuid, p_client_id uuid, p_start_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_program public.programs%rowtype;
  v_existing public.program_assignments%rowtype;
  v_slot record;
begin
  select * into v_program from public.programs p where p.id = p_program_id;
  if not found or not public.is_coach_of(v_program.workspace_id)
     or not public.is_client_in(v_program.workspace_id, p_client_id) then
    raise exception 'Only a coach of this workspace can assign its programs to its clients' using errcode = '42501';
  end if;
  if p_assignment_id is null or p_start_date is null then
    raise exception 'An assignment id and a start date are required' using errcode = '22004';
  end if;

  insert into public.program_assignments (id, workspace_id, client_id, program_id, program_name, weeks, start_date)
  values (p_assignment_id, v_program.workspace_id, p_client_id, v_program.id, v_program.name, v_program.weeks,
    p_start_date)
  on conflict (id) do nothing;

  if not found then
    select * into v_existing from public.program_assignments a where a.id = p_assignment_id;
    if v_existing.workspace_id = v_program.workspace_id and v_existing.client_id = p_client_id
       and v_existing.program_id = p_program_id and v_existing.start_date = p_start_date then
      return p_assignment_id;
    end if;
    raise exception 'This assignment id is already used for a different assignment' using errcode = '23505';
  end if;

  for v_slot in
    select pw.workout_id, pw.week, pw.day
    from public.program_workouts pw
    -- Defensive: only library workouts of the program's own workspace (the slot policy already ensures this).
    join public.workouts w on w.id = pw.workout_id and w.client_id is null and w.workspace_id = v_program.workspace_id
    where pw.program_id = p_program_id and pw.week <= v_program.weeks
    order by pw.week, pw.day, pw.position, pw.created_at
  loop
    perform public.copy_workout(v_slot.workout_id, p_client_id,
      p_start_date + ((v_slot.week - 1) * 7 + (v_slot.day - 1)), p_assignment_id, null);
  end loop;

  return p_assignment_id;
end;
$$;
revoke execute on function public.assign_program(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.assign_program(uuid, uuid, uuid, date) to authenticated;

-- Put one library workout on a client's calendar. p_new_id is generated by the app: a retry with the same id
-- (same client and source) returns it without copying again; the same id used for anything else raises 23505.
-- Raises 42501 unless p_workout_id is a library workout of a workspace the caller coaches and p_client_id is a
-- current client of it.
create function public.schedule_workout(p_new_id uuid, p_workout_id uuid, p_client_id uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_existing public.workouts%rowtype;
begin
  select w.workspace_id into v_workspace_id from public.workouts w where w.id = p_workout_id and w.client_id is null;
  if not found or not public.is_coach_of(v_workspace_id) or not public.is_client_in(v_workspace_id, p_client_id) then
    raise exception 'Only a coach of this workspace can schedule its library workouts for its clients'
      using errcode = '42501';
  end if;
  if p_new_id is null or p_date is null then
    raise exception 'A workout id and a date are required' using errcode = '22004';
  end if;

  if public.copy_workout(p_workout_id, p_client_id, p_date, null, p_new_id) is not null then
    return p_new_id;
  end if;

  select * into v_existing from public.workouts w where w.id = p_new_id;
  if v_existing.workspace_id = v_workspace_id and v_existing.client_id = p_client_id
     and v_existing.source_workout_id = p_workout_id and v_existing.assignment_id is null then
    return p_new_id;
  end if;
  raise exception 'This workout id is already used for a different workout' using errcode = '23505';
end;
$$;
revoke execute on function public.schedule_workout(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.schedule_workout(uuid, uuid, uuid, date) to authenticated;

-- Stop an assignment from p_from_date: delete that assignment's workouts scheduled on or after it and record
-- cancelled_on. When none of its workouts remain, the assignment row is deleted instead. Returns the number of
-- workouts deleted. Coaches of the assignment's workspace only (42501 otherwise, including when it doesn't exist).
create function public.unassign_program(p_assignment_id uuid, p_from_date date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
  v_deleted int;
begin
  select a.workspace_id into v_workspace_id from public.program_assignments a where a.id = p_assignment_id
  for update;
  if not found or not public.is_coach_of(v_workspace_id) then
    raise exception 'Only a coach of this workspace can unassign its programs' using errcode = '42501';
  end if;
  if p_from_date is null then
    raise exception 'A date is required' using errcode = '22004';
  end if;

  delete from public.workouts w where w.assignment_id = p_assignment_id and w.scheduled_on >= p_from_date;
  get diagnostics v_deleted = row_count;

  if exists (select 1 from public.workouts w where w.assignment_id = p_assignment_id) then
    -- Keep the earliest date if it was already cancelled once.
    update public.program_assignments a set cancelled_on = least(coalesce(a.cancelled_on, p_from_date), p_from_date)
    where a.id = p_assignment_id;
  else
    delete from public.program_assignments a where a.id = p_assignment_id;
  end if;

  return v_deleted;
end;
$$;
revoke execute on function public.unassign_program(uuid, date) from public, anon;
grant execute on function public.unassign_program(uuid, date) to authenticated;
