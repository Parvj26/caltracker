-- Coach fixes for the client calendar, the Clients list and the exercise search (CW1, CW2, CW4).
--
-- 1. create_client_workout: "+ New workout" from a client's "Add a workout" window. The coach builds a workout for
--    one client's day; it is saved straight onto that client's calendar as a single workout that came from nowhere
--    (no library workout, no program). The workout row is inserted first, then the usual save_workout writes its
--    blocks, exercises and sets, all in one transaction. It is marked customised from the start (like a "Copy to…"
--    copy), so writing its rows is not a later "hand edit": the client gets one "new workout" push, not a second
--    "today's workout changed" one.
-- 2. untouched_library_copies: which of some calendar workouts are still exactly a library workout (a copy nobody has
--    edited, of a library workout that hasn't changed since). Their ⋯ menu says "In Library" instead of offering
--    "Save to Library".
-- 3. rename_invite: the pending-invite window saves a new name. client_invites is written only by the service role
--    (send-invite) and definer functions, so coaches rename through this.
--
-- No new tables, so no new policies.

-- 1 ----------------------------------------------------------------------------------------------------------------

-- p_doc is a workout document as save_workout takes it; its id is made by the browser once per editor, so a retry
-- sends the same id: the same id for the same client (and workspace) saves again; for anything else it raises 23505.
-- Raises 42501 unless the caller coaches p_workspace_id and p_client_id is a current client of it.
create function public.create_client_workout(p_workspace_id uuid, p_client_id uuid, p_date date, p_doc jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p_doc ->> 'id')::uuid;
  v_existing public.workouts%rowtype;
  v_prev text := coalesce(current_setting('caltracker.system_write', true), '');
  v_out uuid;
  v_rows integer;
begin
  if not public.is_coach_of(p_workspace_id) or not public.is_client_in(p_workspace_id, p_client_id) then
    raise exception 'Only a coach of this workspace can add workouts for its clients' using errcode = '42501';
  end if;
  if v_id is null or p_date is null then
    raise exception 'A workout id and a date are required' using errcode = '22004';
  end if;

  -- The row itself is a system write (it sets customised_at, which coaches can't write).
  perform set_config('caltracker.system_write', 'on', true);
  insert into public.workouts (id, workspace_id, client_id, scheduled_on, assignment_id, source_workout_id, name, notes,
    planned_on, source_hash, customised_at)
  values (v_id, p_workspace_id, p_client_id, p_date, null, null, coalesce(btrim(p_doc ->> 'name'), ''),
    p_doc ->> 'notes', null, null, now())
  on conflict (id) do nothing;
  get diagnostics v_rows = row_count;
  perform set_config('caltracker.system_write', v_prev, true);
  if v_rows = 0 then
    select * into v_existing from public.workouts w where w.id = v_id;
    if v_existing.workspace_id is distinct from p_workspace_id or v_existing.client_id is distinct from p_client_id
       or v_existing.assignment_id is not null then
      raise exception 'This workout id is already used for a different workout' using errcode = '23505';
    end if;
  end if;

  -- The usual save (its document guards, measurements and remembered choices). It checks the coach again.
  v_out := public.save_workout(p_workspace_id, p_doc);
  return v_out;
end;
$$;
revoke execute on function public.create_client_workout(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.create_client_workout(uuid, uuid, date, jsonb) to authenticated;

-- 2 ----------------------------------------------------------------------------------------------------------------

-- Of p_ids, the client workouts (in workspaces the caller coaches) that are untouched copies of a library workout
-- that still exists and hasn't changed since the copy was made: not customised, and the library workout's content
-- hash is still the one recorded on the copy. Anything else (and anything the caller can't see) is left out.
create function public.untouched_library_copies(p_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select w.id
  from public.workouts w
  join public.workouts l on l.id = w.source_workout_id and l.client_id is null and l.workspace_id = w.workspace_id
  where w.id = any(coalesce(p_ids, '{}'))
    and w.client_id is not null
    and public.is_coach_of(w.workspace_id)
    and w.customised_at is null
    and w.source_hash is not null
    and w.source_hash = public.workout_content_hash(l.id);
$$;
revoke execute on function public.untouched_library_copies(uuid[]) from public, anon;
grant execute on function public.untouched_library_copies(uuid[]) to authenticated;

-- 3 ----------------------------------------------------------------------------------------------------------------

-- Renames an open invite (first name 1 to 100 characters after trimming, last name up to 100). Raises 42501 unless
-- the caller coaches its workspace, 55000 once it has been accepted, and 22023 for a bad name.
create function public.rename_invite(p_invite_id uuid, p_first_name text, p_last_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv public.client_invites%rowtype;
  v_first text := btrim(coalesce(p_first_name, ''));
  v_last text := btrim(coalesce(p_last_name, ''));
begin
  select * into inv from public.client_invites i where i.id = p_invite_id for update;
  if not found or not public.is_coach_of(inv.workspace_id) then
    raise exception 'Only a coach of this workspace can rename its invites' using errcode = '42501';
  end if;
  if inv.accepted_at is not null then
    raise exception 'This invite was already accepted' using errcode = '55000';
  end if;
  if char_length(v_first) not between 1 and 100 or char_length(v_last) > 100 then
    raise exception 'Enter a first name (1 to 100 characters) and a last name of at most 100' using errcode = '22023';
  end if;
  update public.client_invites set first_name = v_first, last_name = v_last where id = p_invite_id;
end;
$$;
revoke execute on function public.rename_invite(uuid, text, text) from public, anon;
grant execute on function public.rename_invite(uuid, text, text) to authenticated;
