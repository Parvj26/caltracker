-- Faster building (spec: docs/superpowers/specs/2026-11-06-coach-faster-building-design.md).
--
-- duplicate_program copies a program and all its slots into a new program of the same workspace.
-- replace_program_weeks swaps the slots of some weeks for new ones ("Copy week 1 to week 2", "Repeat week 1"):
-- the app works out the new slots (copyWeek in packages/shared) and this replaces them in one transaction.
--
-- Both are security invoker, like set_program_weeks: RLS decides what the caller may read and write, so another
-- workspace's program is simply not found (refused with 42501), and a slot may only point at a library workout of
-- the program's own workspace (program_workouts_insert). No new tables, so no new policies.

create function public.duplicate_program(p_new_id uuid, p_program_id uuid, p_name text) returns uuid
language plpgsql set search_path = '' as $$
begin
  insert into public.programs (id, workspace_id, name, description, weeks)
  select p_new_id, p.workspace_id, btrim(p_name), p.description, p.weeks
  from public.programs p
  where p.id = p_program_id;
  if not found then
    raise exception 'Program not found.' using errcode = '42501';
  end if;
  -- workspace_id comes from the new program (trigger inherit_program_owner).
  insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  select gen_random_uuid(), p_new_id, pw.week, pw.day, pw.position, pw.workout_id
  from public.program_workouts pw
  where pw.program_id = p_program_id;
  return p_new_id;
end;
$$;
revoke execute on function public.duplicate_program(uuid, uuid, text) from public, anon;
grant execute on function public.duplicate_program(uuid, uuid, text) to authenticated;

-- p_slots: [{ "id", "week", "day", "position", "workoutId" }]. Every slot must be in one of p_weeks, and every week
-- must be inside the program. Returns how many slots were added.
create function public.replace_program_weeks(p_program_id uuid, p_weeks smallint[], p_slots jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v_weeks smallint;
  v_added int;
begin
  select p.weeks into v_weeks from public.programs p where p.id = p_program_id;
  if not found then
    raise exception 'Program not found.' using errcode = '42501';
  end if;
  if p_weeks is null or cardinality(p_weeks) = 0
     or exists (select 1 from unnest(p_weeks) w where w is null or w < 1 or w > v_weeks) then
    raise exception 'Pick weeks inside the program.' using errcode = '23514';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' then
    raise exception 'Slots must be a list.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_slots) s
    where (s.value ->> 'week') is null or not ((s.value ->> 'week')::smallint = any (p_weeks))
  ) then
    raise exception 'Every new workout must be in one of the weeks being replaced.' using errcode = '23514';
  end if;

  delete from public.program_workouts pw where pw.program_id = p_program_id and pw.week = any (p_weeks);
  insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  select (s.value ->> 'id')::uuid, p_program_id, (s.value ->> 'week')::smallint, (s.value ->> 'day')::smallint,
    (s.value ->> 'position')::smallint, (s.value ->> 'workoutId')::uuid
  from jsonb_array_elements(p_slots) s;
  get diagnostics v_added = row_count;
  return v_added;
end;
$$;
revoke execute on function public.replace_program_weeks(uuid, smallint[], jsonb) from public, anon;
grant execute on function public.replace_program_weeks(uuid, smallint[], jsonb) to authenticated;
