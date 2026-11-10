-- Admin dashboard, part 3: support actions, the test notification and "View as" data.
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md
-- Plan: docs/superpowers/plans/2026-11-09-admin-dashboard.md (Task 3)
--
-- All need the support role or higher, and each call writes one admin_audit_log row.
-- "Move client to another coach" = admin_remove_client, then a resend-invite from the new coach's workspace
-- (send-invite, Task 4). "Restore a removed client" = a resend-invite to the past_clients email.

-- 1. remove_client: the body moves to private.remove_client_core so admins remove exactly the way coaches do -------

create function private.remove_client_core(p_workspace_id uuid, p_user_id uuid, p_removed_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.workspace_members%rowtype;
begin
  select * into m from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role = 'client'
  for update;
  if not found then
    raise exception 'Not a client of this workspace' using errcode = 'P0002';
  end if;

  insert into public.past_clients (workspace_id, user_id, email, first_name, last_name, joined_at, removed_by)
  select p_workspace_id, p_user_id, lower(trim(u.email)), coalesce(p.first_name, ''), coalesce(p.last_name, ''),
    m.created_at, p_removed_by
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id
  on conflict (workspace_id, user_id) do update
    set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name,
        joined_at = excluded.joined_at, removed_at = now(), removed_by = excluded.removed_by;

  delete from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role = 'client';
end;
$$;
revoke execute on function private.remove_client_core(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Coach (owner or staff) removes a client. Raises 42501 for anyone else, P0002 when they aren't a client here.
create or replace function public.remove_client(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_coach_of(p_workspace_id) then
    raise exception 'Only a coach of this workspace can remove clients' using errcode = '42501';
  end if;
  perform private.remove_client_core(p_workspace_id, p_user_id, (select auth.uid()));
end;
$$;

-- 2. The test notification type ------------------------------------------------------------------------------------

alter table public.push_outbox drop constraint push_outbox_type_check;
alter table public.push_outbox add constraint push_outbox_type_check check (type in (
  'workout_assigned', 'workout_changed', 'daily_reminder', 'coach_logged', 'message', 'workout_comment',
  'meal_comment', 'food_targets', 'community_coach_post', 'community_activity', 'test'
));

-- 3. Support actions --------------------------------------------------------------------------------------------------

-- Deletes an invite that hasn't been accepted (as the coach's Cancel does).
create function public.admin_cancel_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.client_invites%rowtype;
begin
  perform private.admin_require('support');
  delete from public.client_invites i where i.id = p_invite_id and i.accepted_at is null returning * into v_invite;
  if v_invite.id is null then
    raise exception 'admin: invite is not pending' using errcode = 'P0002';
  end if;
  perform private.admin_audit('cancel_invite',
    (select u.id from auth.users u where lower(u.email) = lower(v_invite.email::text)),
    jsonb_build_object('invite_id', v_invite.id, 'workspace_id', v_invite.workspace_id, 'email', v_invite.email::text));
end;
$$;

-- Removes a client from their coach, exactly as the coach would (removed_by = the workspace owner).
create function public.admin_remove_client(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_done uuid[] := '{}';
begin
  perform private.admin_require('support');
  for v_ws in
    select m.workspace_id from public.workspace_members m
    where m.user_id = p_user_id and m.role = 'client'
    order by m.created_at, m.workspace_id
  loop
    perform private.remove_client_core(v_ws, p_user_id,
      (select o.user_id from public.workspace_members o where o.workspace_id = v_ws and o.role = 'owner' limit 1));
    v_done := v_done || v_ws;
  end loop;
  if cardinality(v_done) = 0 then
    raise exception 'admin: not a client' using errcode = 'P0002';
  end if;
  perform private.admin_audit('remove_client', p_user_id, jsonb_build_object('workspace_ids', to_jsonb(v_done)));
end;
$$;

-- For actions done outside SQL: the admin site writes the audit row first, then acts. Only password_reset: a resend
-- is audited by admin_can_invite (send-invite), so it is never logged twice. p_target is a user or null; p_details
-- is at most 2 KB.
create function public.admin_log_action(p_action text, p_target uuid, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_require('support');
  if p_action is null or p_action not in ('password_reset') then
    raise exception 'admin: unknown action' using errcode = '22023';
  end if;
  if p_target is not null and not exists (select 1 from auth.users u where u.id = p_target) then
    raise exception 'admin: target is not a user' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_details, '{}'::jsonb)::text) > 2048 then
    raise exception 'admin: details too large' using errcode = '22023';
  end if;
  perform private.admin_audit(p_action, p_target, p_details);
end;
$$;

-- Queues a 'test' push for the user (send-push sends it at once, ignoring preferences and quiet hours). At most one
-- a minute per user, so a double-click (or a script) can't spam their phone.
create function public.admin_send_test_push(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.admin_require('support');
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'admin: no such user' using errcode = 'P0002';
  end if;
  -- Serialise concurrent calls for this user so both can't pass the check.
  perform pg_advisory_xact_lock(hashtextextended('admin_send_test_push:' || p_user_id::text, 0));
  if exists (
    select 1 from public.push_outbox o
    where o.user_id = p_user_id and o.type = 'test' and o.created_at > now() - interval '60 seconds'
  ) then
    raise exception 'admin: test notification already sent, wait a minute';
  end if;
  v_id := gen_random_uuid();
  insert into public.push_outbox (id, user_id, workspace_id, type, group_key)
  values (v_id, p_user_id,
    (select m.workspace_id from public.workspace_members m where m.user_id = p_user_id and m.role = 'client'
     order by m.created_at desc limit 1),
    'test', 'test:' || v_id::text);
  perform private.admin_audit('send_test_push', p_user_id, jsonb_build_object('push_id', v_id));
  return v_id;
end;
$$;

-- Audited before the admin site asks PostHog for this user's events.
create function public.admin_log_timeline_view(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_require('support');
  perform private.admin_audit('log_timeline_view', p_user_id, '{}'::jsonb);
end;
$$;

-- 4. View as (read-only) ----------------------------------------------------------------------------------------------

-- What the client's Today, Workouts, Food and Progress screens read, from their current coach's workspace only (a
-- removed client sees no coach data, so: coach null, empty lists). Dates are the client's own (public.client_today).
--   profile {name, units}; coach {name} | null;
--   today {date, workouts [{id, name, status: planned | in_progress | done}]};
--   week {done, planned}: this week's (Monday start) scheduled workouts, and how many have a completed log;
--   recent_logs [<= 10 {id, title, finished_at, duration_s, volume}] (volume: the stored award's volumeKg, or null);
--   meals_today [{name, kcal, protein_g}]; targets {kcal, protein_g} | null; goal {text, target_date} | null;
--   coach_meals (count); bests [<= 5 {exercise, weight, reps, at}] (heaviest lifts, newest first).
create function public.admin_view_as_snapshot(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_today date;
  v_monday date;
begin
  perform private.admin_require('support');
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'admin: no such user' using errcode = 'P0002';
  end if;
  select m.workspace_id into v_ws from public.workspace_members m
  where m.user_id = p_user_id and m.role = 'client'
  order by m.created_at desc limit 1;
  v_today := public.client_today(p_user_id, v_ws);
  v_monday := date_trunc('week', v_today)::date;

  perform private.admin_audit('view_as_snapshot', p_user_id, jsonb_build_object('workspace_id', v_ws));

  return jsonb_build_object(
    'profile', (select jsonb_build_object('name', coalesce(btrim(p.full_name), ''), 'units', p.units)
                from public.profiles p where p.id = p_user_id),
    'coach', (select jsonb_build_object('name', private.admin_name(o.user_id))
              from public.workspace_members o where o.workspace_id = v_ws and o.role = 'owner' limit 1),
    'today', jsonb_build_object('date', v_today, 'workouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'status',
          case
            when exists (select 1 from public.workout_logs l where l.workout_id = w.id and l.status = 'completed') then 'done'
            when exists (select 1 from public.workout_logs l where l.workout_id = w.id and l.status = 'in_progress')
              then 'in_progress'
            else 'planned' end) order by w.created_at, w.id)
      from public.workouts w
      where w.workspace_id = v_ws and w.client_id = p_user_id and w.scheduled_on = v_today), '[]'::jsonb)),
    'week', (select jsonb_build_object(
        'done', count(*) filter (where exists (
          select 1 from public.workout_logs l where l.workout_id = w.id and l.status = 'completed')),
        'planned', count(*))
      from public.workouts w
      where w.workspace_id = v_ws and w.client_id = p_user_id and w.scheduled_on between v_monday and v_monday + 6),
    'recent_logs', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.name, 'finished_at', x.finished_at,
          'duration_s', x.duration_s, 'volume', x.volume) order by x.finished_at desc, x.id)
      from (
        select l.id, l.name, l.finished_at,
          extract(epoch from (l.finished_at - l.started_at))::integer as duration_s,
          (select (a.result ->> 'volumeKg')::numeric from public.awards a where a.log_id = l.id) as volume
        from public.workout_logs l
        where l.workspace_id = v_ws and l.client_id = p_user_id and l.status = 'completed'
        order by l.finished_at desc, l.id
        limit 10) x), '[]'::jsonb),
    'meals_today', coalesce((
      select jsonb_agg(jsonb_build_object('name', ml.name, 'kcal', ml.calories, 'protein_g', ml.protein_g)
        order by ml.eaten_at, ml.id)
      from public.meals ml
      where ml.workspace_id = v_ws and ml.client_id = p_user_id and ml.eaten_on = v_today), '[]'::jsonb),
    'targets', (select jsonb_build_object('kcal', t.calories, 'protein_g', t.protein_g)
                from public.nutrition_targets t where t.workspace_id = v_ws and t.client_id = p_user_id),
    'goal', (select jsonb_build_object('text', g.goal, 'target_date', g.target_date)
             from public.client_goals g where g.workspace_id = v_ws and g.client_id = p_user_id),
    'coach_meals', (select count(*) from public.coach_meals cm where cm.workspace_id = v_ws and cm.deleted_at is null),
    'bests', coalesce((
      select jsonb_agg(jsonb_build_object('exercise', x.exercise, 'weight', x.weight, 'reps', x.reps, 'at', x.at)
        order by x.at desc)
      from (
        select e.name as exercise, pr.value_kg as weight, pr.reps, pr.achieved_at as at
        from public.personal_records pr join public.exercises e on e.id = pr.exercise_id
        where pr.workspace_id = v_ws and pr.client_id = p_user_id and pr.kind = 'heaviest'
        order by pr.achieved_at desc, pr.id
        limit 5) x), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.admin_cancel_invite(uuid), public.admin_remove_client(uuid),
  public.admin_log_action(text, uuid, jsonb), public.admin_send_test_push(uuid), public.admin_log_timeline_view(uuid),
  public.admin_view_as_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_cancel_invite(uuid), public.admin_remove_client(uuid),
  public.admin_log_action(text, uuid, jsonb), public.admin_send_test_push(uuid), public.admin_log_timeline_view(uuid),
  public.admin_view_as_snapshot(uuid)
  to authenticated;
