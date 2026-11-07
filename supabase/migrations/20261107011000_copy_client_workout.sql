-- "Copy to…" on a client's calendar workout: copies it as it is now (with every change the coach made for that client)
-- onto another day, for the same client or others of the same workspace.
--
-- The copy is a single workout, never part of a program: no assignment, no program day (planned_on), no library hash
-- (source_hash), and it is marked customised. Live Sync only ever touches copies that belong to an assignment, so it
-- never refreshes or removes this one: what the coach copied is what the client gets. source_workout_id keeps the
-- library workout the original came from (if any), so the copy still links back to it.
--
-- A done workout can be copied: the copy is a fresh plan (its blocks, exercises, sets and substitutes), with no log.
-- The done-workout lock (20261106009000) is unaffected: the copy is a new workout with no log of its own.

-- p_new_id is made by the app, so a double click or a retry sends the same id: an existing copy with that id for the
-- same client, day and library source returns it without copying again; the id used for anything else raises 23505.
-- Raises 42501 unless the caller coaches the source workout's workspace and p_client_id is a current client of it.
create function public.copy_client_workout(p_source uuid, p_new_id uuid, p_client_id uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_source public.workouts%rowtype;
  v_existing public.workouts%rowtype;
  v_prev text := coalesce(current_setting('caltracker.system_write', true), '');
begin
  select * into v_source from public.workouts w where w.id = p_source and w.client_id is not null;
  if not found or not public.is_coach_of(v_source.workspace_id)
     or not public.is_client_in(v_source.workspace_id, p_client_id) then
    raise exception 'Only a coach of this workspace can copy its clients'' workouts to its clients'
      using errcode = '42501';
  end if;
  if p_new_id is null or p_date is null then
    raise exception 'A workout id and a date are required' using errcode = '22004';
  end if;

  -- A system write, like copy_workout: the copy's own rows don't count as hand edits, and it sets its own tracking
  -- columns (customised from the start).
  perform set_config('caltracker.system_write', 'on', true);
  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes,
    planned_on, source_hash, customised_at)
  values (p_new_id, v_source.workspace_id, p_client_id, p_date, null, v_source.source_workout_id, v_source.name,
    v_source.notes, null, null, now())
  on conflict (id) do nothing;
  if not found then
    perform set_config('caltracker.system_write', v_prev, true);
    select * into v_existing from public.workouts w where w.id = p_new_id;
    if v_existing.workspace_id = v_source.workspace_id and v_existing.client_id = p_client_id
       and v_existing.scheduled_on = p_date and v_existing.assignment_id is null
       and v_existing.source_workout_id is not distinct from v_source.source_workout_id then
      return p_new_id;
    end if;
    raise exception 'This workout id is already used for a different workout' using errcode = '23505';
  end if;

  perform public.copy_workout_children(p_source, p_new_id);
  perform set_config('caltracker.system_write', v_prev, true);
  return p_new_id;
end;
$$;
revoke execute on function public.copy_client_workout(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.copy_client_workout(uuid, uuid, uuid, date) to authenticated;
