-- Push notifications: device, preference and outbox tables (spec docs/superpowers/specs/2026-11-09-client-push-notifications-design.md).
begin;
select plan(36);

select tests.create_user('pt-coach@t.local', 'Luis Bueno') as coach \gset
select tests.create_workspace('PT Coaching', :'coach') as ws \gset
select tests.create_user('pt-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('PT Other', :'coach2') as ws2 \gset
select tests.create_user('pt-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('pt-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('pt-lee@t.local', 'Lee Other') as lee \gset
select tests.add_client(:'ws2', :'lee');

-- Structure.
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.push_devices'::regclass, 'public.notification_prefs'::regclass, 'public.push_outbox'::regclass)),
  'tables have RLS');
select ok(not has_function_privilege('authenticated', 'private.push_enqueue(uuid, uuid, text, text, jsonb, interval, boolean)', 'execute'),
  'clients cannot call push_enqueue');
select ok(not has_function_privilege('anon', 'public.register_push_device(text, text)', 'execute'), 'anon cannot register a device');
select table_privs_are('public', 'push_outbox', 'authenticated', array[]::text[], 'authenticated has no privileges on push_outbox');
select table_privs_are('public', 'push_outbox', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on push_outbox');

-- Devices.
select tests.act_as(:'sam');
select lives_ok(format('select public.register_push_device(%L, %L)', repeat('a', 64), '1.0.0'), 'sam registers a device');
select is((select count(*)::int from public.push_devices), 1, 'sam sees his device');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from public.push_devices), 0, 'kim cannot see sam''s device');
reset role;
select tests.act_as(:'lee');
select is((select count(*)::int from public.push_devices), 0, 'lee (other workspace) cannot see it');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.push_devices), 0, 'the coach cannot see it');
reset role;
select tests.act_as(:'sam');
select throws_ok(format($$insert into public.push_devices (token, user_id) values (%L, %L)$$, repeat('b', 64), :'sam'),
  '42501', null, 'clients cannot insert devices directly');
select throws_ok(format($$update public.push_devices set user_id = %L$$, :'kim'), '42501', null, 'clients cannot update devices directly');
reset role;

select tests.act_as(:'kim');
select public.register_push_device(repeat('a', 64), '1.0.1');
reset role;
select is((select user_id from public.push_devices where token = repeat('a', 64)), :'kim'::uuid,
  'register moves a token from another user');
select is((select count(*)::int from public.push_devices), 1, 'still one row for that token');

select tests.act_as(:'sam');
select public.unregister_push_device(repeat('a', 64));
reset role;
select is((select count(*)::int from public.push_devices where token = repeat('a', 64)), 1, 'unregister only removes own row');
select tests.act_as(:'kim');
select public.unregister_push_device(repeat('a', 64));
select is((select count(*)::int from public.push_devices), 0, 'unregister removes the caller''s row');
select throws_ok($$select public.register_push_device('not-hex', null)$$, '23514', null, 'bad token refused');
reset role;
select tests.act_as_anon();
select throws_ok(format('select public.register_push_device(%L, null)', repeat('c', 64)), '42501', null, 'anon cannot register');
reset role;

-- Preferences.
select tests.act_as(:'sam');
select lives_ok($$insert into public.notification_prefs (disabled) values ('{message}')$$, 'prefs: sam inserts his row');
select is((select disabled from public.notification_prefs), array['message']::text[], 'prefs: sam reads it back');
select throws_ok($$update public.notification_prefs set disabled = '{bogus}'$$, '23514', null, 'prefs: unknown key refused');
select lives_ok($$update public.notification_prefs set disabled = array['workout_assigned', 'workout_changed', 'daily_reminder',
  'coach_logged', 'still_training', 'message', 'workout_comment', 'meal_comment', 'food_targets', 'community_coach_post',
  'community_activity']$$, 'prefs: every catalogue key accepted');
select throws_ok(format($$insert into public.notification_prefs (user_id) values (%L)$$, :'kim'), '42501', null,
  'prefs: sam cannot pick the user_id');
select is((select reminder_time::text || ' ' || quiet_enabled || ' ' || quiet_start::text || ' ' || quiet_end::text
  from public.notification_prefs), '08:00:00 true 22:00:00 07:00:00', 'prefs: defaults');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from public.notification_prefs), 0, 'prefs: kim sees 0 of sam''s rows');
with u as (update public.notification_prefs set quiet_enabled = false where user_id = :'sam' returning 1)
select is((select count(*)::int from u), 0, 'prefs: kim cannot update sam''s row');
reset role;
select tests.act_as(:'lee');
select is((select count(*)::int from public.notification_prefs), 0, 'prefs: lee sees 0 of sam''s rows');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.notification_prefs), 0, 'prefs: the coach sees 0 of sam''s rows');
reset role;

-- Outbox.
select tests.act_as(:'sam');
select throws_ok('select * from public.push_outbox', '42501', null, 'outbox: authenticated cannot read');
reset role;

select private.push_enqueue(:'coach', :'ws', 'message', 'g', '{}');
select is((select count(*)::int from public.push_outbox), 0, 'enqueue skips non-clients');
select private.push_enqueue(:'lee', :'ws', 'message', 'g', '{}');
select is((select count(*)::int from public.push_outbox), 0, 'enqueue skips other workspace');

select private.push_enqueue(:'sam', :'ws', 'food_targets', 'food_targets', '{"n":1}', interval '1 minute', true);
select private.push_enqueue(:'sam', :'ws', 'food_targets', 'food_targets', '{"n":2}', interval '1 minute', true);
select is((select array_agg(data->>'n') from public.push_outbox where group_key = 'food_targets'), array['2'],
  'enqueue dedupes');

select private.push_enqueue(:'sam', :'ws', 'community_activity', 'ca:p1', '{"n":1}', interval '5 minutes');
-- The first row was queued earlier: its send time is sooner than now() + 5 min.
update public.push_outbox set not_before = now() + interval '3 minutes' where group_key = 'ca:p1';
select private.push_enqueue(:'sam', :'ws', 'community_activity', 'ca:p1', '{"n":2}', interval '5 minutes');
select is((select count(distinct not_before)::int || '/' || count(*)::int from public.push_outbox where group_key = 'ca:p1'), '1/2',
  'late joiner shares send time');

insert into public.push_outbox (user_id, workspace_id, type, group_key) values (:'sam', :'ws', 'daily_reminder', 'daily_reminder:2026-11-09');
select throws_ok(format($$insert into public.push_outbox (user_id, workspace_id, type, group_key)
  values (%L, %L, 'daily_reminder', 'daily_reminder:2026-11-09')$$, :'sam', :'ws'), '23505', null, 'one daily reminder per key');

-- A row the sender gave up on (5 attempts, outcome failed, sent_at still null) is dead: it must not swallow the
-- next change (dedupe) or lend it its old send time (grouping).
update public.push_outbox set attempts = 5, outcome = 'failed', not_before = now() - interval '1 day'
where group_key = 'food_targets';
select private.push_enqueue(:'sam', :'ws', 'food_targets', 'food_targets', '{"n":3}', interval '1 minute', true);
select is((select array_agg(data->>'n' order by created_at, data->>'n') from public.push_outbox
           where group_key = 'food_targets' and attempts < 5), array['3'],
  'a failed row does not swallow the next one');
select ok((select not_before > now() from public.push_outbox where group_key = 'food_targets' and attempts < 5),
  'nor lend it its old send time');

select * from finish();
rollback;
