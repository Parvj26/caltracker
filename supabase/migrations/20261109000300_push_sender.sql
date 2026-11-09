-- Client push notifications, part 3: what the send-push Edge Function calls, and the cron jobs that call it.
-- Spec: docs/superpowers/specs/2026-11-09-client-push-notifications-design.md
-- Plan: docs/superpowers/plans/2026-11-09-client-push-notifications.md (Task 6)
--
-- pg_cron runs public.push_dispatch every minute ('send') and every 15 minutes ('reminders'); it posts the job to the
-- send-push Edge Function with the shared secret from Vault (send_push_url, send_push_secret; see
-- docs/runbooks/staging.md). The function claims due rows, applies preferences, quiet hours and grouping with the
-- pure functions in packages/shared/src/push, sends to APNs and reports back through finish_push_batch. Everything
-- here is for the service role only.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- 1. Sender state: the cached APNs provider token (Apple throttles re-signing) and the key id that signed it, so a
-- rotated key (new APNS_KEY_ID) never reuses the old key's token. ---------------------------------------------------

create table public.push_sender_state (
  id smallint primary key default 1 check (id = 1),
  apns_jwt text,
  apns_jwt_issued_at timestamptz,
  apns_key_id text
);
revoke all on table public.push_sender_state from anon, authenticated, service_role;
grant select, insert, update, delete on public.push_sender_state to service_role;
alter table public.push_sender_state enable row level security;
-- No policies: the service role only.

-- 2. Claiming ---------------------------------------------------------------------------------------------------------

-- Due rows (unsent, not_before reached, under 5 attempts, not claimed by a run still going), oldest first. Claimed
-- for 2 minutes so overlapping runs never send a row twice; a run that dies lets its rows be claimed again.
create function public.claim_push_batch(p_limit integer default 500) returns setof public.push_outbox
language sql security definer set search_path = '' as $$
  with due as (
    select o.id from public.push_outbox o
    where o.sent_at is null and o.not_before <= now() and o.attempts < 5
      and (o.claimed_until is null or o.claimed_until < now())
    order by o.not_before, o.created_at
    limit greatest(coalesce(p_limit, 500), 0)
    for update skip locked
  )
  update public.push_outbox o set claimed_until = now() + interval '2 minutes'
  from due
  where o.id = due.id
  returning o.*;
$$;

-- 3. Per-user context -------------------------------------------------------------------------------------------------

-- The app-icon badge: coach messages the client hasn't read (after their conversation_reads mark; all of them
-- without one) plus unread comment notifications on their community posts. Workout comments have no read state, so
-- they don't count. Only workspaces they are still a client of.
create function public.push_badge_count(p_user uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select (
    select count(*) from public.messages m
    join public.conversations c on c.id = m.conversation_id
    left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = p_user
    where c.client_id = p_user and m.sender_id <> p_user
      and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
      and exists (select 1 from public.workspace_members wm
                  where wm.workspace_id = c.workspace_id and wm.user_id = p_user and wm.role = 'client')
  )::integer + (
    select count(*) from public.community_notifications n
    where n.recipient_id = p_user and n.kind = 'comment' and n.read_at is null
      and exists (select 1 from public.workspace_members wm
                  where wm.workspace_id = n.workspace_id and wm.user_id = p_user and wm.role = 'client')
  )::integer;
$$;

-- What the sender needs per user: their notification_prefs row (null = all defaults), time zone (their own, else
-- their coach's, else UTC), badge and device tokens.
create function public.push_user_context(p_user_ids uuid[])
returns table (user_id uuid, prefs jsonb, time_zone text, badge integer, tokens text[])
language sql stable security definer set search_path = '' as $$
  select u.id,
    (select to_jsonb(np) - 'user_id' - 'updated_at' from public.notification_prefs np where np.user_id = u.id),
    coalesce((
      select public.client_zone(u.id, m.workspace_id) from public.workspace_members m
      where m.user_id = u.id and m.role = 'client'
      order by m.created_at, m.workspace_id
      limit 1
    ), 'UTC'),
    public.push_badge_count(u.id),
    coalesce((select array_agg(d.token order by d.updated_at desc) from public.push_devices d where d.user_id = u.id),
      '{}'::text[])
  from (select distinct x as id from unnest(p_user_ids) x where x is not null) u;
$$;

-- 4. Finishing --------------------------------------------------------------------------------------------------------

-- Records what happened to each claimed row and releases its claim:
--   sent | disabled | no_device | expired -> done (sent_at, outcome);
--   failed -> given up (attempts = 5, outcome 'failed', last_error);
--   retry  -> attempts + 1, not_before, last_error; the 5th failed try gives up;
--   defer  -> not_before only (quiet hours).
-- title/body are stored when given (what the client saw). Device tokens APNs called invalid are deleted.
create function public.finish_push_batch(p_results jsonb, p_dead_tokens text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
begin
  if jsonb_typeof(coalesce(p_results, '[]'::jsonb)) <> 'array' then
    raise exception 'finish_push_batch: p_results must be an array' using errcode = '22023';
  end if;
  select r.outcome into v_bad
  from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as r(id uuid, outcome text)
  where r.id is null or r.outcome is null
    or r.outcome not in ('sent', 'disabled', 'no_device', 'expired', 'failed', 'retry', 'defer')
  limit 1;
  if found then
    raise exception 'finish_push_batch: unknown outcome %', coalesce(v_bad, '(none)') using errcode = '22023';
  end if;

  update public.push_outbox o set
    sent_at = case when r.outcome in ('sent', 'disabled', 'no_device', 'expired') then now() else o.sent_at end,
    outcome = case
      when r.outcome in ('sent', 'disabled', 'no_device', 'expired', 'failed') then r.outcome
      when r.outcome = 'retry' and o.attempts + 1 >= 5 then 'failed'
      else o.outcome end,
    attempts = case
      when r.outcome = 'failed' then 5
      when r.outcome = 'retry' then o.attempts + 1
      else o.attempts end,
    not_before = case when r.outcome in ('retry', 'defer') then coalesce(r.not_before, o.not_before) else o.not_before end,
    last_error = case when r.outcome in ('failed', 'retry') then left(r.error, 500) else o.last_error end,
    title = coalesce(r.title, o.title),
    body = coalesce(r.body, o.body),
    claimed_until = null
  from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb))
    as r(id uuid, outcome text, not_before timestamptz, title text, body text, error text)
  where o.id = r.id;

  delete from public.push_devices d where d.token = any (coalesce(p_dead_tokens, '{}'::text[]));
end;
$$;

-- 5. Daily reminder candidates ----------------------------------------------------------------------------------------

-- Current clients with a known zone (their own or their coach's) who have a workout on their today with no log in
-- progress or completed, and have not switched the reminder off. The sender decides with reminderDue
-- (packages/shared) whether the reminder time has come and none was sent today (last_reminder_at).
create function public.push_reminder_candidates()
returns table (user_id uuid, workspace_id uuid, time_zone text, prefs jsonb, workout_id uuid, workout_name text,
  workout_count integer, last_reminder_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with clients as (
    select m.user_id, m.workspace_id, public.client_zone(m.user_id, m.workspace_id) as zone
    from public.workspace_members m
    where m.role = 'client'
  ), open_today as (
    select c.user_id, c.workspace_id, c.zone, w.id, w.name, w.created_at
    from clients c
    join public.workouts w on w.client_id = c.user_id and w.workspace_id = c.workspace_id
      and w.scheduled_on = (now() at time zone c.zone)::date
    where c.zone is not null
      and not exists (select 1 from public.workout_logs l
                      where l.workout_id = w.id and l.status in ('in_progress', 'completed'))
  )
  select o.user_id, o.workspace_id, o.zone,
    (select to_jsonb(np) - 'user_id' - 'updated_at' from public.notification_prefs np where np.user_id = o.user_id),
    (array_agg(o.id order by o.created_at, o.id))[1],
    (array_agg(o.name order by o.created_at, o.id))[1],
    count(*)::integer,
    (select max(x.created_at) from public.push_outbox x where x.user_id = o.user_id and x.type = 'daily_reminder')
  from open_today o
  where not exists (select 1 from public.notification_prefs np
                    where np.user_id = o.user_id and 'daily_reminder' = any (np.disabled))
  group by o.user_id, o.workspace_id, o.zone;
$$;

revoke execute on function public.claim_push_batch(integer), public.push_badge_count(uuid),
  public.push_user_context(uuid[]), public.finish_push_batch(jsonb, text[]), public.push_reminder_candidates()
  from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer), public.push_badge_count(uuid),
  public.push_user_context(uuid[]), public.finish_push_batch(jsonb, text[]), public.push_reminder_candidates()
  to service_role;

-- 6. Dispatch and cron ------------------------------------------------------------------------------------------------

-- Posts a job ('send' or 'reminders') to the send-push Edge Function. 'send' also clears out finished rows older
-- than 30 days (sent or given up). Fails loudly (shown in cron.job_run_details) without its Vault secrets.
create function public.push_dispatch(p_job text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if p_job is null or p_job not in ('send', 'reminders') then
    raise exception 'push_dispatch: unknown job %', coalesce(p_job, '(null)') using errcode = '22023';
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'send_push_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'send_push_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'push_dispatch: create the Vault secrets send_push_url and send_push_secret '
      '(docs/runbooks/staging.md)' using errcode = '55000';
  end if;

  if p_job = 'send' then
    delete from public.push_outbox o
    where o.created_at < now() - interval '30 days' and (o.sent_at is not null or o.attempts >= 5);
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('job', p_job),
    headers := jsonb_build_object('content-type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke execute on function public.push_dispatch(text) from public, anon, authenticated, service_role;

-- Re-running this migration must not duplicate the jobs.
select cron.unschedule(jobid) from cron.job where jobname in ('push-send', 'push-reminders');
select cron.schedule('push-send', '* * * * *', 'select public.push_dispatch(''send'')');
select cron.schedule('push-reminders', '*/15 * * * *', 'select public.push_dispatch(''reminders'')');
