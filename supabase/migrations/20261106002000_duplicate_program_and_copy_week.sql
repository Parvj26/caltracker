-- Faster building (spec: docs/superpowers/specs/2026-11-06-coach-faster-building-design.md).
--
-- duplicate_program copies a program and all its slots into a new program of the same workspace.
-- copy_program_week copies one week's slots onto other weeks, replacing what they held ("Copy week 1 to week 2",
-- "Repeat week 1 for the following weeks").
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

-- copy_program_week: "Copy week 1 to weeks 2 and 3". Each target week ends up holding exactly the source week's
-- workouts (same days and order): its old slots are deleted and the source's are copied in, in one transaction.
-- p_to must be distinct weeks in increasing order, inside the program and not p_from. p_ids are the new slot ids,
-- made by the browser so the program grid already shows the ids the database keeps: one per copy, ordered by
-- target week (as in p_to), then the source slots by day, position and id (copyWeek in packages/shared uses the
-- same order). A count that doesn't match the source week (it changed since the page loaded) is refused.
-- Returns the new slots.
create function public.copy_program_week(p_program_id uuid, p_from smallint, p_to smallint[], p_ids uuid[])
returns table (id uuid, week smallint, day smallint, "position" smallint, workout_id uuid)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_weeks smallint;
  v_source int;
begin
  select p.weeks into v_weeks from public.programs p where p.id = p_program_id;
  if not found then
    raise exception 'Program not found.' using errcode = '42501';
  end if;
  if p_from is null or p_from < 1 or p_from > v_weeks then
    raise exception 'Pick a week inside the program to copy.' using errcode = '23514';
  end if;
  if p_to is null or cardinality(p_to) = 0
     or exists (select 1 from unnest(p_to) t(w) where t.w is null or t.w < 1 or t.w > v_weeks or t.w = p_from)
     or exists (
       select 1 from unnest(p_to) with ordinality a(w, i)
       join unnest(p_to) with ordinality b(w, i) on b.i = a.i + 1
       where b.w <= a.w
     ) then
    raise exception 'Pick other weeks inside the program, each once, in order.' using errcode = '23514';
  end if;

  select count(*) into v_source from public.program_workouts pw where pw.program_id = p_program_id and pw.week = p_from;
  if v_source = 0 then
    raise exception 'Week % has no workouts to copy.', p_from using errcode = '23514';
  end if;
  if p_ids is null or cardinality(p_ids) <> v_source * cardinality(p_to)
     or exists (select 1 from unnest(p_ids) x(v) where x.v is null) then
    raise exception 'That week changed since the page loaded. Reload the page and try again.' using errcode = '23514';
  end if;

  delete from public.program_workouts pw where pw.program_id = p_program_id and pw.week = any (p_to);
  -- workspace_id comes from the program (trigger inherit_program_owner); RLS checks each workout is the
  -- workspace's own library workout.
  insert into public.program_workouts (id, program_id, week, day, position, workout_id)
  select p_ids[((t.i - 1) * v_source + s.n)::int], p_program_id, t.w, s.day, s.position, s.workout_id
  from unnest(p_to) with ordinality t(w, i)
  cross join (
    select x.day, x.position, x.workout_id, row_number() over (order by x.day, x.position, x.id) as n
    from public.program_workouts x
    where x.program_id = p_program_id and x.week = p_from
  ) s;

  return query
    select pw.id, pw.week, pw.day, pw.position, pw.workout_id
    from public.program_workouts pw
    where pw.program_id = p_program_id and pw.week = any (p_to)
    order by pw.week, pw.day, pw.position, pw.id;
end;
$$;
revoke execute on function public.copy_program_week(uuid, smallint, smallint[], uuid[]) from public, anon;
grant execute on function public.copy_program_week(uuid, smallint, smallint[], uuid[]) to authenticated;
