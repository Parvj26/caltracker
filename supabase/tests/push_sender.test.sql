-- Push notifications: the SQL the send-push Edge Function calls, the dispatcher and its cron jobs (plan Task 6).
begin;
select plan(46);

select tests.create_user('ps-coach@t.local', 'Luis Bueno') as coach \gset
select tests.create_workspace('PS Coaching', :'coach') as ws \gset
select tests.create_user('ps-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('ps-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('ps-ana@t.local', 'Ana Ruiz') as ana \gset
select tests.add_client(:'ws', :'ana');
select tests.create_user('ps-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('PS Other', :'coach2') as ws2 \gset
select tests.create_user('ps-lee@t.local', 'Lee Other') as lee \gset
select tests.add_client(:'ws2', :'lee');
select tests.create_user('ps-coach3@t.local', 'Zone Less') as coach3 \gset
select tests.create_workspace('PS No Zone', :'coach3') as ws3 \gset
select tests.create_user('ps-zed@t.local', 'Zed Nozone') as zed \gset
select tests.add_client(:'ws3', :'zed');

-- Privileges ---------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.claim_push_batch(integer)', 'execute')
  and not has_function_privilege('anon', 'public.claim_push_batch(integer)', 'execute'), 'clients cannot claim pushes');
select ok(not has_function_privilege('authenticated', 'public.push_badge_count(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.push_badge_count(uuid)', 'execute'), 'clients cannot read badge counts');
select ok(not has_function_privilege('authenticated', 'public.push_user_context(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.push_user_context(uuid[])', 'execute'), 'clients cannot read push context');
select ok(not has_function_privilege('authenticated', 'public.finish_push_batch(jsonb, text[])', 'execute')
  and not has_function_privilege('anon', 'public.finish_push_batch(jsonb, text[])', 'execute'), 'clients cannot finish pushes');
select ok(not has_function_privilege('authenticated', 'public.push_reminder_candidates()', 'execute')
  and not has_function_privilege('anon', 'public.push_reminder_candidates()', 'execute'), 'clients cannot list reminder candidates');
select ok(has_function_privilege('service_role', 'public.claim_push_batch(integer)', 'execute')
  and has_function_privilege('service_role', 'public.push_badge_count(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.push_user_context(uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.finish_push_batch(jsonb, text[])', 'execute')
  and has_function_privilege('service_role', 'public.push_reminder_candidates()', 'execute'),
  'the service role can call the sender functions');
select ok(not has_function_privilege('service_role', 'public.push_dispatch(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.push_dispatch(text)', 'execute')
  and not has_function_privilege('anon', 'public.push_dispatch(text)', 'execute')
  and not has_function_privilege('service_role', 'public.push_cleanup()', 'execute')
  and not has_function_privilege('authenticated', 'public.push_cleanup()', 'execute')
  and not has_function_privilege('anon', 'public.push_cleanup()', 'execute'), 'only postgres (cron) runs push_dispatch and push_cleanup');
select ok((select relrowsecurity from pg_class where oid = 'public.push_sender_state'::regclass), 'push_sender_state has RLS');
select table_privs_are('public', 'push_sender_state', 'authenticated', array[]::text[], 'clients cannot touch the sender state');
select table_privs_are('public', 'push_sender_state', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'the service role reads and writes the sender state');
select throws_ok($$insert into public.push_sender_state (id, apns_jwt) values (2, 'x')$$, '23514', null, 'the sender state is one row');

-- Claiming -----------------------------------------------------------------------------------------------------------
insert into public.push_outbox (id, user_id, workspace_id, type, group_key, not_before) values
  ('00000000-0000-4000-8000-0000000000a1', :'sam', :'ws', 'message', 'g1', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000a2', :'sam', :'ws', 'message', 'g1', now() - interval '1 minute'),
  ('00000000-0000-4000-8000-0000000000a3', :'kim', :'ws', 'food_targets', 'food_targets', now()),
  ('00000000-0000-4000-8000-0000000000a4', :'kim', :'ws', 'message', 'g2', now() + interval '1 minute');
insert into public.push_outbox (id, user_id, workspace_id, type, group_key, attempts) values
  ('00000000-0000-4000-8000-0000000000a5', :'kim', :'ws', 'message', 'g3', 5);
insert into public.push_outbox (id, user_id, workspace_id, type, group_key, sent_at, outcome) values
  ('00000000-0000-4000-8000-0000000000a6', :'kim', :'ws', 'message', 'g4', now(), 'sent');

select set_eq('select id from public.claim_push_batch()',
  $$values ('00000000-0000-4000-8000-0000000000a1'::uuid), ('00000000-0000-4000-8000-0000000000a2'::uuid),
    ('00000000-0000-4000-8000-0000000000a3'::uuid)$$,
  'claim returns due rows (not future, not sent, not at 5 attempts)');
select is((select count(*)::int from public.claim_push_batch()), 0, 'a second claim returns nothing');
select ok((select bool_and(claimed_until = now() + interval '2 minutes') from public.push_outbox
  where id in ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a3')), 'claimed for 2 minutes');
update public.push_outbox set claimed_until = now() - interval '1 second' where id = '00000000-0000-4000-8000-0000000000a1';
select is((select array_agg(id) from public.claim_push_batch()), array['00000000-0000-4000-8000-0000000000a1'::uuid],
  'claim takes back an expired claim');
update public.push_outbox set claimed_until = null where sent_at is null;
select is((select count(*)::int from public.claim_push_batch(1)), 1, 'claim honours its limit');

-- Finishing -----------------------------------------------------------------------------------------------------------
insert into public.push_devices (token, user_id) values (repeat('d', 64), :'kim'), (repeat('e', 64), :'kim');
select public.finish_push_batch(jsonb_build_array(
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a1', 'outcome', 'sent', 'title', 'Message from Luis',
    'body', 'Luis sent you 2 messages.'),
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a2', 'outcome', 'retry',
    'not_before', '2030-01-01T00:00:00Z', 'error', 'HTTP 503'),
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a3', 'outcome', 'failed', 'error', 'BadTopic'),
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a4', 'outcome', 'defer', 'not_before', '2030-01-02T07:00:00Z')
), array[repeat('d', 64)]);
select results_eq($$select sent_at = now(), outcome, title, body, claimed_until from public.push_outbox
  where id = '00000000-0000-4000-8000-0000000000a1'$$,
  $$values (true, 'sent'::text, 'Message from Luis'::text, 'Luis sent you 2 messages.'::text, null::timestamptz)$$,
  'finish: sent');
select results_eq($$select sent_at, attempts, not_before, last_error, outcome from public.push_outbox
  where id = '00000000-0000-4000-8000-0000000000a2'$$,
  $$values (null::timestamptz, 1, '2030-01-01T00:00:00Z'::timestamptz, 'HTTP 503'::text, null::text)$$, 'finish: retry');
select results_eq($$select sent_at, attempts, outcome, last_error from public.push_outbox
  where id = '00000000-0000-4000-8000-0000000000a3'$$,
  $$values (null::timestamptz, 5, 'failed'::text, 'BadTopic'::text)$$, 'finish: failed');
select results_eq($$select sent_at, attempts, not_before from public.push_outbox where id = '00000000-0000-4000-8000-0000000000a4'$$,
  $$values (null::timestamptz, 0, '2030-01-02T07:00:00Z'::timestamptz)$$, 'finish: defer');
select is((select array_agg(token) from public.push_devices where user_id = :'kim'), array[repeat('e', 64)], 'finish: dead tokens are deleted');
update public.push_outbox set attempts = 4 where id = '00000000-0000-4000-8000-0000000000a2';
select public.finish_push_batch(jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a2',
  'outcome', 'retry', 'not_before', '2030-01-01T00:00:00Z', 'error', 'HTTP 503')), '{}');
select results_eq($$select attempts, outcome from public.push_outbox where id = '00000000-0000-4000-8000-0000000000a2'$$,
  $$values (5, 'failed'::text)$$, 'finish: the 5th failed try gives up');
select throws_ok($$select public.finish_push_batch('[{"id": "00000000-0000-4000-8000-0000000000a4", "outcome": "bogus"}]', '{}')$$,
  '22023', null, 'finish: an unknown outcome is refused');
delete from public.push_outbox;

-- Badge -------------------------------------------------------------------------------------------------------------
select tests.act_as(:'coach');
select public.get_or_create_conversation(:'sam') as conv \gset
reset role;
insert into public.messages (conversation_id, sender_id, body) values
  (:'conv', :'coach', 'old'), (:'conv', :'coach', 'new 1'), (:'conv', :'coach', 'new 2'), (:'conv', :'sam', 'mine');
update public.messages set created_at = now() - interval '2 hours' where body = 'old';
update public.messages set created_at = now() - interval '30 minutes' where body in ('new 1', 'new 2', 'mine');
insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (:'conv', :'sam', now() - interval '1 hour');
select id as comm from public.communities where workspace_id = :'ws' \gset
select gen_random_uuid() as post \gset
select tests.act_as(:'sam');
select public.create_community_post(:'post', :'comm', 'Hello');
reset role;
insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id) values
  (:'ws', :'comm', :'sam', 'comment', :'post', :'kim'),
  (:'ws', :'comm', :'sam', 'reaction', :'post', :'kim');
insert into public.community_notifications (workspace_id, community_id, recipient_id, kind, post_id, actor_id, read_at) values
  (:'ws', :'comm', :'sam', 'comment', :'post', :'ana', now());
select is(public.push_badge_count(:'sam'), 3, 'badge counts unread coach messages and comment notifications');
select is(public.push_badge_count(:'kim'), 0, 'another client''s badge is their own');
select tests.act_as(:'sam');
select public.mark_conversation_read(:'conv');
reset role;
select is(public.push_badge_count(:'sam'), 1, 'badge drops after mark_conversation_read');

delete from public.push_devices;

-- Context -----------------------------------------------------------------------------------------------------------
insert into public.push_devices (token, user_id) values (repeat('a', 64), :'sam'), (repeat('b', 64), :'sam');
insert into public.notification_prefs (user_id, disabled, quiet_enabled) values (:'sam', '{message}', false);
update public.profiles set time_zone = 'Europe/London' where id = :'sam';
update public.profiles set time_zone = 'America/New_York' where id = :'coach';
select results_eq(format($$select prefs->'disabled', (prefs->>'quiet_enabled')::boolean, prefs->>'reminder_time', time_zone, badge,
  (select array_agg(t order by t) from unnest(tokens) t) from public.push_user_context(array[%L]::uuid[])$$, :'sam'),
  format($$values ('["message"]'::jsonb, false, '08:00:00'::text, 'Europe/London'::text, 1, array[%L, %L])$$, repeat('a', 64), repeat('b', 64)),
  'context returns prefs, tokens and badge');
select results_eq(format($$select prefs, time_zone, tokens from public.push_user_context(array[%L]::uuid[])$$, :'kim'),
  $$values (null::jsonb, 'America/New_York'::text, '{}'::text[])$$, 'context falls back to the coach''s zone');
select is((select time_zone from public.push_user_context(array[:'zed']::uuid[])), 'UTC', 'context uses UTC when nothing is known');
select is((select count(*)::int from public.push_user_context(array[:'sam', :'kim', :'lee']::uuid[])), 3, 'one context row per user');

-- Reminder candidates -----------------------------------------------------------------------------------------------
-- London: sam (workout today); kim (done today); ana (in progress today); lee (has a workout but switched reminders off).
update public.profiles set time_zone = 'Europe/London' where id in (:'kim', :'ana', :'lee');
select (now() at time zone 'Europe/London')::date as ldn_today \gset
select tests.create_workout(:'ws', 'Upper A', :'sam', :'ldn_today') as sam_w1 \gset
select tests.create_workout(:'ws', 'Lower B', :'sam', :'ldn_today') as sam_w2 \gset
update public.workouts set created_at = now() + interval '1 second' where id = :'sam_w2';
select tests.create_workout(:'ws', 'Tomorrow', :'sam', (:'ldn_today'::date + 1)) as sam_w3 \gset
select tests.create_workout(:'ws', 'Kim day', :'kim', :'ldn_today') as kim_w \gset
select tests.create_log(:'ws', :'kim', :'kim_w', 'completed');
select tests.create_workout(:'ws', 'Ana day', :'ana', :'ldn_today') as ana_w \gset
select tests.create_log(:'ws', :'ana', :'ana_w', 'in_progress');
select tests.create_workout(:'ws2', 'Lee day', :'lee', :'ldn_today') as lee_w \gset
insert into public.notification_prefs (user_id, disabled) values (:'lee', '{daily_reminder}');
insert into public.push_outbox (user_id, workspace_id, type, group_key, created_at, sent_at, outcome)
values (:'sam', :'ws', 'daily_reminder', 'daily_reminder:2026-01-01', '2026-01-01T08:05:00Z', '2026-01-01T08:05:00Z', 'sent');

select results_eq(format($$select workspace_id, time_zone, workout_id, workout_name, workout_count, last_reminder_at
  from public.push_reminder_candidates() where user_id = %L$$, :'sam'),
  format($$values (%L::uuid, 'Europe/London'::text, %L::uuid, 'Upper A'::text, 2, '2026-01-01T08:05:00Z'::timestamptz)$$, :'ws', :'sam_w1'),
  'reminder candidates: workout today, not done (first workout, count, last reminder)');
select is((select count(*)::int from public.push_reminder_candidates() where user_id = :'kim'), 0, 'reminder candidates: not when done today');
select is((select count(*)::int from public.push_reminder_candidates() where user_id = :'ana'), 0, 'reminder candidates: not when in progress');
select is((select count(*)::int from public.push_reminder_candidates() where user_id = :'lee'), 0, 'reminder candidates: not when switched off');
select is((select prefs->>'reminder_time' from public.push_reminder_candidates() where user_id = :'sam'), '08:00:00',
  'reminder candidates carry the prefs');

-- A client in Auckland is matched on their own date, which can differ from London's.
update public.profiles set time_zone = 'Pacific/Auckland' where id = :'zed';
select (now() at time zone 'Pacific/Auckland')::date as akl_today \gset
select tests.create_workout(:'ws3', 'Zed today', :'zed', :'akl_today') as zed_w \gset
select tests.create_workout(:'ws3', 'Zed other', :'zed', (:'akl_today'::date - 1)) as zed_w2 \gset
select results_eq(format($$select workout_id, workout_count, time_zone from public.push_reminder_candidates() where user_id = %L$$, :'zed'),
  format($$values (%L::uuid, 1, 'Pacific/Auckland'::text)$$, :'zed_w'), 'reminder candidates are per client time zone');
select tests.create_user('ps-nozone@t.local', 'No Zone') as nozone \gset
select tests.add_client(:'ws3', :'nozone');
update public.profiles set time_zone = 'UTC' where id = :'coach3';
update public.profiles set time_zone = 'UTC' where id = :'zed';
select tests.create_workout(:'ws3', 'Unknown', :'nozone', (now() at time zone 'UTC')::date) as nz_w \gset
select is((select count(*)::int from public.push_reminder_candidates() where user_id in (:'nozone', :'zed')), 0,
  'reminder candidates skip clients whose zone is unknown');

-- Dispatch ----------------------------------------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  for v_id in select id from vault.secrets where name in ('send_push_url', 'send_push_secret') loop
    perform vault.update_secret(v_id, '');
  end loop;
end;
$$;
select throws_ok($$select public.push_dispatch('send')$$, '55000', null, 'dispatch fails without its Vault secrets');
do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'send_push_url';
  if v_id is null then
    perform vault.create_secret('http://push.test/functions/v1/send-push', 'send_push_url');
  else
    perform vault.update_secret(v_id, 'http://push.test/functions/v1/send-push');
  end if;
  select id into v_id from vault.secrets where name = 'send_push_secret';
  if v_id is null then
    perform vault.create_secret('pgtap-push-secret', 'send_push_secret');
  else
    perform vault.update_secret(v_id, 'pgtap-push-secret');
  end if;
end;
$$;
select throws_ok($$select public.push_dispatch('bogus')$$, '22023', null, 'dispatch refuses an unknown job');
insert into public.push_outbox (user_id, workspace_id, type, group_key, created_at, sent_at, outcome) values
  (:'sam', :'ws', 'message', 'old-sent', now() - interval '31 days', now() - interval '31 days', 'sent'),
  (:'sam', :'ws', 'message', 'recent-sent', now() - interval '29 days', now() - interval '29 days', 'sent');
insert into public.push_outbox (user_id, workspace_id, type, group_key, created_at, attempts, outcome) values
  (:'sam', :'ws', 'message', 'old-failed', now() - interval '31 days', 5, 'failed');
insert into public.push_outbox (user_id, workspace_id, type, group_key, created_at, not_before) values
  (:'sam', :'ws', 'message', 'old-pending', now() - interval '31 days', now() + interval '1 hour');
select lives_ok($$select public.push_dispatch('send')$$, 'dispatch send runs');
select is((select count(*)::int from public.push_outbox where group_key in ('old-sent', 'old-failed')), 2,
  'dispatch send leaves the clean-up to its own hourly job');
select lives_ok($$select public.push_dispatch('reminders')$$, 'dispatch reminders runs');
select results_eq($$select convert_from(q.body, 'utf8')::jsonb ->> 'job', q.headers ->> 'x-push-secret' from net.http_request_queue q
  where q.url = 'http://push.test/functions/v1/send-push' order by q.id$$,
  $$values ('send'::text, 'pgtap-push-secret'::text), ('reminders', 'pgtap-push-secret')$$, 'dispatch posts the job with the secret');
select lives_ok($$select public.push_cleanup()$$, 'clean-up runs');
select set_eq($$select group_key from public.push_outbox where group_key in ('old-sent', 'recent-sent', 'old-failed', 'old-pending')$$,
  $$values ('recent-sent'), ('old-pending')$$, 'clean-up deletes finished rows older than 30 days');

-- Cron ----------------------------------------------------------------------------------------------------------------
select results_eq($$select jobname::text, schedule::text, command::text from cron.job
  where jobname in ('push-send', 'push-reminders', 'push-cleanup') order by jobname$$,
  $$values ('push-cleanup', '17 * * * *', 'select public.push_cleanup()'),
    ('push-reminders', '*/15 * * * *', 'select public.push_dispatch(''reminders'')'),
    ('push-send', '* * * * *', 'select public.push_dispatch(''send'')')$$, 'cron jobs are scheduled once');

select * from finish();
rollback;
