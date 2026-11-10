-- A coach can point a program day at a different library workout ("Just this day" saves a copy of the workout and
-- moves only that day to it). The new workout must be a library workout of the same workspace, as on insert.
grant update (workout_id) on public.program_workouts to authenticated;

drop policy program_workouts_update on public.program_workouts;
create policy program_workouts_update on public.program_workouts for update to authenticated
  using (public.is_coach_of(workspace_id))
  with check (public.is_coach_of(workspace_id) and public.is_library_workout_of(workout_id, workspace_id));
