-- Points one program day at another library workout of the same workspace ("Just this day" saves a copy of the
-- workout and moves only that day to it). workout_id stays non-updatable for authenticated directly; this checks the
-- caller coaches the workspace, that the day belongs to a program of that workspace, and that the workout is one of
-- its library workouts. Returns false when there is no such day for the caller.
create function public.set_program_slot_workout(p_slot_id uuid, p_workout_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_workspace_id uuid;
begin
  -- The day's workspace, only when it matches its program's (locked so it can't move while we check).
  select pw.workspace_id into v_workspace_id
  from public.program_workouts pw
  join public.programs p on p.id = pw.program_id and p.workspace_id = pw.workspace_id
  where pw.id = p_slot_id
  for update of pw;
  if v_workspace_id is null or not public.is_coach_of(v_workspace_id) then
    return false;
  end if;
  if p_workout_id is null or not public.is_library_workout_of(p_workout_id, v_workspace_id) then
    raise exception 'That workout is not in this workspace''s library' using errcode = '42501';
  end if;
  update public.program_workouts set workout_id = p_workout_id
  where id = p_slot_id and workspace_id = v_workspace_id;
  return true;
end;
$$;
revoke execute on function public.set_program_slot_workout(uuid, uuid) from public, anon, service_role;
grant execute on function public.set_program_slot_workout(uuid, uuid) to authenticated;
