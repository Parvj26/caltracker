-- A client's workout that has a completed log keeps its plan: its name, notes and day, and its blocks, exercises,
-- sets and substitutes. The log was done against that plan, so changing it afterwards would make the coach's
-- "planned vs. actual" wrong. The coach edits the logged results instead (correct_log). A missed workout, or one
-- with only an in-progress or discarded log, stays editable.
--
-- Triggers rather than a check in save_workout, so every path is covered: save_workout, direct table writes and any
-- later copy-and-replace path. Deleting a done workout still works: the workouts trigger watches updates only, and a
-- child row being removed because its workout is being deleted (on delete cascade) is let through. Library workouts
-- and fresh copies never have logs, so they are never refused.

create function public.workout_is_done(p_workout_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workout_logs l where l.workout_id = p_workout_id and l.status = 'completed'
  );
$$;
revoke execute on function public.workout_is_done(uuid) from public, anon, authenticated;

create function public.refuse_done_plan_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_workout_id uuid;
begin
  if tg_table_name = 'workouts' then
    -- Only the plan's own columns: assignment links and timestamps may still change.
    if (new.name, new.notes, new.scheduled_on) is not distinct from (old.name, old.notes, old.scheduled_on) then
      return new;
    end if;
    v_workout_id := old.id;
  elsif tg_op = 'INSERT' then
    -- The inherit_owner trigger (it runs first: triggers fire in name order) has filled in workout_id.
    v_workout_id := new.workout_id;
  elsif tg_op = 'UPDATE' then
    v_workout_id := old.workout_id;
  else
    v_workout_id := old.workout_id;
    -- Removed because its workout (or its parent row) is being deleted: let the cascade through.
    if not exists (select 1 from public.workouts w where w.id = v_workout_id) then
      return old;
    end if;
  end if;

  if public.workout_is_done(v_workout_id) then
    raise exception 'This workout is already done, so its plan can''t change. Edit the logged results instead.'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke execute on function public.refuse_done_plan_change() from public, anon, authenticated;

-- Named "..._lock_done_plan" so each fires after "..._inherit_owner" (inserts) and before "..._touch_updated_at".
create trigger workouts_lock_done_plan before update of name, notes, scheduled_on on public.workouts
  for each row execute function public.refuse_done_plan_change();
create trigger workout_blocks_lock_done_plan before insert or update or delete on public.workout_blocks
  for each row execute function public.refuse_done_plan_change();
create trigger workout_exercises_lock_done_plan before insert or update or delete on public.workout_exercises
  for each row execute function public.refuse_done_plan_change();
create trigger workout_sets_lock_done_plan before insert or update or delete on public.workout_sets
  for each row execute function public.refuse_done_plan_change();
create trigger workout_substitutes_lock_done_plan before insert or update or delete on public.workout_substitutes
  for each row execute function public.refuse_done_plan_change();
