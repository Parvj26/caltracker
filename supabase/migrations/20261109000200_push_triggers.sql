-- Client push notifications, part 2: what puts a push in the outbox.
-- Spec: docs/superpowers/specs/2026-11-09-client-push-notifications-design.md
-- Plan: docs/superpowers/plans/2026-11-09-client-push-notifications.md (Task 5)
--
-- Every trigger is an AFTER row trigger, security definer, and queues through private.push_enqueue, which only
-- queues for a current client of the workspace. The actor is auth.uid() unless noted, must be a coach (owner or
-- staff) of the workspace (any member, for community activity) and never the recipient. A push's data holds names and
-- ids only (shapes: PushData in packages/shared/src/push/data.ts), never message, comment or meal text.
-- Meal comments do not exist (coaches reply about a meal by message), so meal_comment has no trigger.

-- Today in the client's zone (their own, else their coach's; UTC when neither is known).
create function private.push_client_today(p_client uuid, p_workspace uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(public.client_zone(p_client, p_workspace), 'UTC'))::date;
$$;
revoke execute on function private.push_client_today(uuid, uuid) from public, anon, authenticated, service_role;

-- 1. Workouts -------------------------------------------------------------------------------------------------------

-- A program assigned: one push for the whole program (its copies have assignment_id set, so they add none).
create function private.push_on_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or v_actor = new.client_id or not private.push_is_coach(new.workspace_id, v_actor) then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'workout_assigned', 'workout_assigned:' || new.id,
    jsonb_build_object('actorName', private.push_first_name(v_actor), 'name', new.program_name));
  return null;
end;
$$;
revoke execute on function private.push_on_assignment() from public, anon, authenticated, service_role;
create trigger program_assignments_push after insert on public.program_assignments
  for each row execute function private.push_on_assignment();

-- A single workout put on a client's calendar.
create function private.push_on_single_workout() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.client_id is null or new.assignment_id is not null or v_actor is null or v_actor = new.client_id
     or not private.push_is_coach(new.workspace_id, v_actor) then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'workout_assigned', 'workout_assigned:' || new.id,
    jsonb_build_object('actorName', private.push_first_name(v_actor), 'name', new.name));
  return null;
end;
$$;
revoke execute on function private.push_on_single_workout() from public, anon, authenticated, service_role;
create trigger workouts_push_assigned after insert on public.workouts
  for each row execute function private.push_on_single_workout();

-- The coach changed a workout on the client's today (save_workout always rewrites the row, so updated_at moves on
-- every save). One pending push per workout, sent 2 minutes after the first change. Not for updates that only move
-- links (library workout or assignment deleted, created_by), and not once the workout is done.
-- Live Sync never changes a copy on the client's today (it leaves today as the client has it), so a library edit
-- adds nothing here.
create function private.push_on_workout_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.client_id is null or v_actor is null or v_actor = new.client_id then
    return null;
  end if;
  if (new.name, new.notes, new.scheduled_on, new.customised_at, new.source_hash)
       is not distinct from (old.name, old.notes, old.scheduled_on, old.customised_at, old.source_hash)
     and (new.updated_at is not distinct from old.updated_at
       or (new.assignment_id, new.source_workout_id, new.created_by)
         is distinct from (old.assignment_id, old.source_workout_id, old.created_by)) then
    return null;
  end if;
  if new.scheduled_on is distinct from private.push_client_today(new.client_id, new.workspace_id)
     or not private.push_is_coach(new.workspace_id, v_actor)
     or exists (select 1 from public.workout_logs l where l.workout_id = new.id and l.status = 'completed') then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'workout_changed', 'workout_changed:' || new.id,
    jsonb_build_object('actorName', private.push_first_name(v_actor), 'workoutId', new.id, 'workoutName', new.name),
    interval '2 minutes', true);
  return null;
end;
$$;
revoke execute on function private.push_on_workout_change() from public, anon, authenticated, service_role;
create trigger workouts_push_changed after update on public.workouts
  for each row execute function private.push_on_workout_change();

-- A workout moved off its day or deleted before its "Today's workout changed" went out: that push no longer makes
-- sense, so it is dropped (whoever made the change).
create function private.push_drop_workout_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.scheduled_on is not distinct from old.scheduled_on
     or new.scheduled_on = private.push_client_today(new.client_id, new.workspace_id)) then
    return null; -- moved onto today: push_on_workout_change has just queued it
  end if;
  delete from public.push_outbox o
  where o.user_id = old.client_id and o.type = 'workout_changed' and o.group_key = 'workout_changed:' || old.id
    and o.sent_at is null;
  return null;
end;
$$;
revoke execute on function private.push_drop_workout_changed() from public, anon, authenticated, service_role;
create trigger workouts_push_drop_changed after update of scheduled_on or delete on public.workouts
  for each row when (old.client_id is not null) execute function private.push_drop_workout_changed();

-- 2. Logs -----------------------------------------------------------------------------------------------------------

-- The coach finished logging a session for the client (not the hourly auto-finish; not the client's own log).
-- The actor is the log's logged_by.
create function private.push_on_coach_logged() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'completed' or (tg_op = 'UPDATE' and old.status = 'completed') or new.auto_finished
     or new.logged_by is null or new.logged_by = new.client_id
     or not private.push_is_coach(new.workspace_id, new.logged_by) then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'coach_logged', 'coach_logged:' || new.id,
    jsonb_build_object('actorName', private.push_first_name(new.logged_by), 'logId', new.id),
    interval '0', true);
  return null;
end;
$$;
revoke execute on function private.push_on_coach_logged() from public, anon, authenticated, service_role;
create trigger workout_logs_push_coach_logged after insert or update of status on public.workout_logs
  for each row execute function private.push_on_coach_logged();

-- The coach commented on the client's workout log.
create function private.push_on_log_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is null or new.author_id = new.client_id
     or not private.push_is_coach(new.workspace_id, new.author_id) then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'workout_comment', 'workout_comment:' || new.log_id,
    jsonb_build_object('actorName', private.push_first_name(new.author_id), 'logId', new.log_id,
      'workoutName', (select l.name from public.workout_logs l where l.id = new.log_id)));
  return null;
end;
$$;
revoke execute on function private.push_on_log_comment() from public, anon, authenticated, service_role;
create trigger workout_log_comments_push after insert on public.workout_log_comments
  for each row execute function private.push_on_log_comment();

-- 3. Messages -------------------------------------------------------------------------------------------------------

-- A message from the coach. One group per conversation: a burst becomes "Luis sent you 3 messages."
create function private.push_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
begin
  select c.client_id into v_client from public.conversations c where c.id = new.conversation_id;
  if v_client is null or new.sender_id = v_client or not private.push_is_coach(new.workspace_id, new.sender_id) then
    return null;
  end if;
  perform private.push_enqueue(v_client, new.workspace_id, 'message', 'message:' || new.conversation_id,
    jsonb_build_object('actorName', private.push_first_name(new.sender_id), 'conversationId', new.conversation_id));
  return null;
end;
$$;
revoke execute on function private.push_on_message() from public, anon, authenticated, service_role;
create trigger messages_push after insert on public.messages
  for each row execute function private.push_on_message();

-- 4. Food targets ---------------------------------------------------------------------------------------------------

-- The coach set or changed the client's daily targets (updated_by is the caller, set by the before trigger). One
-- pending push, sent a minute after the first change; a save that changes no number adds nothing.
create function private.push_on_targets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.calories, new.protein_g, new.carbs_g, new.fat_g)
       is not distinct from (old.calories, old.protein_g, old.carbs_g, old.fat_g) then
    return null;
  end if;
  if new.updated_by is null or new.updated_by = new.client_id
     or not private.push_is_coach(new.workspace_id, new.updated_by) then
    return null;
  end if;
  perform private.push_enqueue(new.client_id, new.workspace_id, 'food_targets', 'food_targets',
    jsonb_build_object('actorName', private.push_first_name(new.updated_by)), interval '1 minute', true);
  return null;
end;
$$;
revoke execute on function private.push_on_targets() from public, anon, authenticated, service_role;
create trigger nutrition_targets_push after insert or update on public.nutrition_targets
  for each row execute function private.push_on_targets();

-- 5. Community ------------------------------------------------------------------------------------------------------

-- Follows the in-app community notifications (already one per recipient, never to the actor, removed members left
-- out): a coach post, and comments and reactions on the client's own post. Reactions to a comment are not pushed.
-- Activity waits 5 minutes so a burst goes out as one "Sam and 4 others reacted to your post."
create function private.push_on_community_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.actor_id is null or new.actor_id = new.recipient_id or new.post_id is null then
    return null;
  end if;
  if new.kind = 'coach_post' then
    if not private.push_is_coach(new.workspace_id, new.actor_id) then
      return null;
    end if;
    perform private.push_enqueue(new.recipient_id, new.workspace_id, 'community_coach_post',
      'community_coach_post:' || new.post_id,
      jsonb_build_object('actorName', private.push_first_name(new.actor_id), 'postId', new.post_id,
        'communityName', (select w.name from public.workspaces w where w.id = new.workspace_id)));
  elsif new.kind = 'comment' or (new.kind = 'reaction' and new.comment_id is null) then
    if not exists (select 1 from public.workspace_members m
                   where m.workspace_id = new.workspace_id and m.user_id = new.actor_id) then
      return null;
    end if;
    perform private.push_enqueue(new.recipient_id, new.workspace_id, 'community_activity',
      'community_activity:' || new.kind || ':' || new.post_id,
      jsonb_build_object('actorId', new.actor_id, 'actorName', private.push_first_name(new.actor_id),
        'postId', new.post_id, 'activity', new.kind, 'notificationId', new.id),
      interval '5 minutes');
  end if;
  return null;
end;
$$;
revoke execute on function private.push_on_community_notification() from public, anon, authenticated, service_role;
create trigger community_notifications_push after insert on public.community_notifications
  for each row execute function private.push_on_community_notification();

-- A reaction taken back (or a post or comment deleted) removes its in-app notification: drop its unsent push too.
create function private.push_on_community_unnotify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_outbox o
  where o.user_id = old.recipient_id and o.sent_at is null and o.data ->> 'notificationId' = old.id::text;
  return null;
end;
$$;
revoke execute on function private.push_on_community_unnotify() from public, anon, authenticated, service_role;
create trigger community_notifications_push_unnotify after delete on public.community_notifications
  for each row execute function private.push_on_community_unnotify();

-- 6. Removed clients ------------------------------------------------------------------------------------------------

-- A client removed from a workspace gets nothing more from it, not even pushes queued before the removal.
create function private.push_on_member_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_outbox o
  where o.user_id = old.user_id and o.workspace_id = old.workspace_id and o.sent_at is null;
  return null;
end;
$$;
revoke execute on function private.push_on_member_removed() from public, anon, authenticated, service_role;
create trigger workspace_members_push_removed after delete on public.workspace_members
  for each row execute function private.push_on_member_removed();
