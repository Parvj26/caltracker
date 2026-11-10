-- Admin read functions: Overview, Coaches, Clients and Logs (docs/superpowers/specs/2026-11-09-admin-dashboard-design.md).
begin;
select plan(54);

-- Admins.
select tests.create_user('ar-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('ar-support@t.local', 'Sue Port') as support \gset
select tests.create_user('ar-ro@t.local', 'Rita Reader') as ro \gset
select tests.create_user('ar-nobody@t.local', 'No Body') as nobody \gset
insert into public.admin_users (user_id, role)
values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');

-- The overview before this file's seed (the local seed may hold other data): counts are checked as differences.
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.admin_overview() as base \gset
select set_config('request.jwt.claims', '', true);

-- Coaches: Ann (active today), Bob (nothing for 30 days), Cat (new, last active 10 days ago).
select tests.create_user('ar-ann@t.local', 'Ann Coach') as ann \gset
select tests.create_workspace('AR Alpha', :'ann') as ws_a \gset
select tests.create_user('ar-bob@t.local', 'Bob Coach') as bob \gset
select tests.create_workspace('AR Beta', :'bob') as ws_b \gset
select tests.create_user('ar-cat@t.local', 'Cat Coach') as cat \gset
select tests.create_workspace('AR Gamma', :'cat') as ws_c \gset
update public.workspace_members set created_at = now() - interval '30 days' where user_id in (:'ann', :'bob');

-- Clients: Sam and Kim (Ann), Lee (Bob), Pat (Cat).
select tests.create_user('ar-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws_a', :'sam');
select tests.create_user('ar-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws_a', :'kim');
select tests.create_user('ar-lee@t.local', 'Lee Ray') as lee \gset
select tests.add_client(:'ws_b', :'lee');
select tests.create_user('ar-pat@t.local', 'Pat Moe') as pat \gset
select tests.add_client(:'ws_c', :'pat');
update public.workspace_members set created_at = now() - interval '20 days' where user_id = :'kim';
update auth.users set last_sign_in_at = now() where id = :'sam';
update auth.users set last_sign_in_at = now() - interval '10 days' where id = :'kim';
update auth.users set last_sign_in_at = now() - interval '1 day' where id in (:'lee', :'pat');

-- Messages: Sam writes 2 h ago, Ann replies 30 minutes later; Cat wrote to Pat 10 days ago.
insert into public.conversations (workspace_id, client_id) values (:'ws_a', :'sam') returning id as conv_a \gset
insert into public.messages (conversation_id, sender_id, body, created_at)
values (:'conv_a', :'sam', 'Hi', now() - interval '2 hours'), (:'conv_a', :'ann', 'Hello', now() - interval '90 minutes');
insert into public.conversations (workspace_id, client_id) values (:'ws_c', :'pat') returning id as conv_c \gset
insert into public.messages (conversation_id, sender_id, body, created_at)
values (:'conv_c', :'cat', 'Welcome', now() - interval '10 days');

-- Ann has a program and a shared meal.
insert into public.programs (workspace_id, name, weeks, created_by) values (:'ws_a', 'AR Strength', 4, :'ann') returning id as prog \gset
insert into public.coach_meals (workspace_id, name, created_by) values (:'ws_a', 'AR Oats', :'ann');

-- Workouts: Sam this week, Lee last week. Meals: Kim this week and last week.
select tests.create_log(:'ws_a', :'sam') as log_sam \gset
update public.workout_logs set finished_at = now() where id = :'log_sam';
select tests.create_log(:'ws_b', :'lee') as log_lee \gset
update public.workout_logs set
  started_at = (date_trunc('week', now() at time zone 'utc') at time zone 'utc') - interval '2 days',
  finished_at = (date_trunc('week', now() at time zone 'utc') at time zone 'utc') - interval '2 days' + interval '1 hour',
  last_activity_at = (date_trunc('week', now() at time zone 'utc') at time zone 'utc') - interval '2 days' + interval '1 hour'
where id = :'log_lee';
insert into public.meals (workspace_id, client_id, eaten_at, eaten_on, name, calories, protein_g)
values (:'ws_a', :'kim', now(), (now() at time zone 'utc')::date, 'AR Lunch', 600, 40),
  (:'ws_a', :'kim', (date_trunc('week', now() at time zone 'utc') at time zone 'utc') - interval '3 days',
   (((date_trunc('week', now() at time zone 'utc') at time zone 'utc') - interval '3 days') at time zone 'utc')::date, 'AR Dinner', 700, 50);

-- Push: Sam has a device and one failed push.
insert into public.push_devices (token, user_id, app_version) values (repeat('ab', 32), :'sam', '9.9.9-ar');
insert into public.push_outbox (user_id, workspace_id, type, group_key, attempts, outcome, last_error)
values (:'sam', :'ws_a', 'message', 'ar-failed', 5, 'failed', 'BadDeviceToken');

-- Invites: an expired one (no account yet), a pending one, and Sam's accepted one.
select tests.create_invite(:'ws_a', 'ar-old@t.local', 'Old Invite', :'ann', 'tok-ar-old-0000000000000',
  now() - interval '2 days') as inv_old \gset
select tests.create_invite(:'ws_a', 'ar-new@t.local', 'New Invite', :'ann', 'tok-ar-new-0000000000000') as inv_new \gset
select tests.create_invite(:'ws_a', 'ar-sam@t.local', 'Sam Lee', :'ann', 'tok-ar-sam-0000000000000') as inv_sam \gset
update public.client_invites set accepted_at = now(), accepted_by = :'sam' where id = :'inv_sam';

-- Audit rows by the owner and by support.
insert into public.admin_audit_log (admin_id, action, target_user_id) values (:'owner', 'set_admin', :'support'),
  (:'support', 'password_reset', :'sam');

-- Each function's denial for a non-admin and for aal1.
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok(q, '42501', 'admin: not authorised', 'non-admin denied: ' || q) from unnest(array[
  'select public.admin_overview()', 'select * from public.admin_needs_attention()', 'select * from public.admin_people()',
  'select * from public.admin_coaches()', format('select public.admin_coach(%L)', :'ann'),
  format('select public.admin_client(%L)', :'sam'), 'select * from public.admin_push_log()',
  'select * from public.admin_invite_log()', 'select * from public.admin_audit()']) q;
reset role;
select tests.act_as_aal(:'owner', 'aal1');
select throws_ok(q, '42501', 'admin: not authorised', 'aal1 owner denied: ' || q) from unnest(array[
  'select public.admin_overview()', 'select * from public.admin_needs_attention()', 'select * from public.admin_people()',
  'select * from public.admin_coaches()', format('select public.admin_coach(%L)', :'ann'),
  format('select public.admin_client(%L)', :'sam'), 'select * from public.admin_push_log()',
  'select * from public.admin_invite_log()', 'select * from public.admin_audit()']) q;
reset role;

-- overview counts.
select tests.act_as_aal(:'owner', 'aal2');
select public.admin_overview() as now_o \gset
reset role;
select results_eq(
  format($$select (n->'coaches'->>'total')::int - (b->'coaches'->>'total')::int,
      (n->'coaches'->>'active7')::int - (b->'coaches'->>'active7')::int,
      (n->'coaches'->>'new7')::int - (b->'coaches'->>'new7')::int
    from (select %L::jsonb as n, %L::jsonb as b) x$$, :'now_o', :'base'),
  $$values (3, 1, 1)$$, 'overview counts: coaches total +3, active in 7 days +1 (Ann), new +1 (Cat)');
select results_eq(
  format($$select (n->'clients'->>'total')::int - (b->'clients'->>'total')::int,
      (n->'clients'->>'active7')::int - (b->'clients'->>'active7')::int,
      (n->'clients'->>'new7')::int - (b->'clients'->>'new7')::int
    from (select %L::jsonb as n, %L::jsonb as b) x$$, :'now_o', :'base'),
  -- Lee's last-week workout counts as active too when last week is within the past 7 days (early in the week).
  format($$values (4, %s, 3)$$, 2 + (select count(*)::int from public.workout_logs
    where id = :'log_lee' and started_at >= now() - interval '7 days')),
  'overview counts: clients total +4, active +2 (Sam log, Kim meal; Lee early in the week), new +3');
select results_eq(
  format($$select (n->'workouts'->>'this_week')::int - (b->'workouts'->>'this_week')::int,
      (n->'workouts'->>'last_week')::int - (b->'workouts'->>'last_week')::int,
      (n->'meals'->>'this_week')::int - (b->'meals'->>'this_week')::int,
      (n->'meals'->>'last_week')::int - (b->'meals'->>'last_week')::int
    from (select %L::jsonb as n, %L::jsonb as b) x$$, :'now_o', :'base'),
  $$values (1, 1, 1, 1)$$, 'overview counts: workouts and meals this week and last week');
select results_eq(
  format($$select (n->'system'->>'push_failed_24h')::int - (b->'system'->>'push_failed_24h')::int,
      (n->'system'->>'invites_sent_today')::int - (b->'system'->>'invites_sent_today')::int
    from (select %L::jsonb as n, %L::jsonb as b) x$$, :'now_o', :'base'),
  $$values (1, 2)$$, 'overview counts: push failures in 24 h and invites sent today');
select ok(:'now_o'::jsonb->'system'->'app_versions' @> '[{"version": "9.9.9-ar", "devices": 1}]',
  'overview lists app versions in use');
select ok((:'now_o'::jsonb->'system') ?& array['last_push_run_at', 'last_push_status'], 'overview has the push-send cron keys');

-- needs attention: one row per kind.
select tests.act_as_aal(:'owner', 'aal2');
select set_has('select kind, user_id, name, action, invite_id from public.admin_needs_attention()',
  format($$values ('invite_expired'::text, null::uuid, 'Old Invite'::text, 'resend_invite'::text, %L::uuid),
    ('no_signin_7d', %L, 'Kim Park', 'open', null),
    ('notifications_off', %L, 'Kim Park', 'open', null),
    ('push_failed', %L, 'Sam Lee', 'open', null),
    ('coach_inactive_14d', %L, 'Bob Coach', 'open', null),
    ('coach_no_meals', %L, 'Bob Coach', 'open', null)$$, :'inv_old', :'kim', :'kim', :'sam', :'bob', :'bob'),
  'needs attention: one row per kind');
select set_hasnt('select kind, user_id from public.admin_needs_attention()',
  format($$values ('no_signin_7d'::text, %L::uuid), ('notifications_off', %L), ('coach_inactive_14d', %L),
    ('coach_no_meals', %L), ('coach_inactive_14d', %L)$$, :'sam', :'sam', :'ann', :'ann', :'cat'),
  'needs attention: healthy people are not listed');
select ok((select bool_and(ok) from (
  select since >= lag(since) over (order by ord) or lag(since) over (order by ord) is null as ok
  from public.admin_needs_attention() with ordinality as t(kind, user_id, name, since, action, invite_id, ord)) x),
  'needs attention is ordered by since');

-- coach health tags.
select results_eq(
  format($$select name, workspace_name, clients, programs_assigned_7d, messages_7d, health from public.admin_coaches()
    where workspace_id in (%L, %L, %L) order by name$$, :'ws_a', :'ws_b', :'ws_c'),
  $$values ('Ann Coach'::text, 'AR Alpha'::text, 2, 0, 1, 'good'::text),
    ('Bob Coach', 'AR Beta', 1, 0, 0, 'inactive'),
    ('Cat Coach', 'AR Gamma', 1, 0, 0, 'quiet')$$,
  'coach health tags: good, inactive, quiet');

-- admin_coach summary.
select public.admin_coach(:'ann') as coach_ann \gset
select is(:'coach_ann'::jsonb->'clients', format('[{"user_id": "%s", "name": "Kim Park"}, {"user_id": "%s", "name": "Sam Lee"}]', :'kim', :'sam')::jsonb,
  'coach summary lists the clients');
select is(:'coach_ann'::jsonb->'programs', format('[{"id": "%s", "name": "AR Strength", "weeks": 4}]', :'prog')::jsonb,
  'coach summary lists the programs');
select is((:'coach_ann'::jsonb->>'meals_shared')::int, 1, 'coach summary counts meals shared');
select is((:'coach_ann'::jsonb->>'median_reply_minutes_30d')::int, 30, 'coach summary: median reply time');
select is(public.admin_coach(:'bob')->'median_reply_minutes_30d', 'null'::jsonb, 'no conversations: median reply is null');
select throws_ok(format('select public.admin_coach(%L)', :'sam'), 'P0002', 'admin: not a coach', 'a client is not a coach');

-- admin_client fields.
select public.admin_client(:'sam') as c_sam \gset
select is(:'c_sam'::jsonb - 'joined_at' - 'last_sign_in_at' - 'last_sync_at' - 'devices' - 'push_errors',
  format('{"user_id": "%s", "name": "Sam Lee", "email": "ar-sam@t.local", "workspace_id": "%s",
    "coach": {"user_id": "%s", "name": "Ann Coach"}, "email_confirmed": true, "notifications_on": true, "removed": null}',
    :'sam', :'ws_a', :'ann')::jsonb,
  'admin_client fields: name, email, coach, email confirmed, notifications on');
select ok((:'c_sam'::jsonb->>'joined_at') is not null and (:'c_sam'::jsonb->>'last_sign_in_at') is not null
  and (:'c_sam'::jsonb->>'last_sync_at') is not null, 'admin_client has joined, last sign-in and last sync times');
select is((select jsonb_agg(d - 'last_seen_at') from jsonb_array_elements(:'c_sam'::jsonb->'devices') d),
  '[{"app_version": "9.9.9-ar"}]'::jsonb, 'admin_client lists devices');
select is((select jsonb_agg(e - 'at') from jsonb_array_elements(:'c_sam'::jsonb->'push_errors') e),
  '[{"type": "message", "error": "BadDeviceToken"}]'::jsonb, 'admin_client lists push errors from the last 7 days');
select is(public.admin_client(:'kim')->'notifications_on', 'false'::jsonb, 'no device: notifications are off');
select throws_ok(format('select public.admin_client(%L)', gen_random_uuid()), 'P0002', 'admin: no such user', 'unknown user');

-- people (the smart-search source), logs.
select set_has('select user_id, kind, name, email, coach_name from public.admin_people()',
  format($$values (%L::uuid, 'client'::text, 'Sam Lee'::text, 'ar-sam@t.local'::text, 'Ann Coach'::text),
    (%L, 'coach', 'Ann Coach', 'ar-ann@t.local', null)$$, :'sam', :'ann'),
  'people lists clients with their coach, and coaches');
select results_eq(format($$select type, outcome, attempts, last_error, name from public.admin_push_log(%L) where outcome = 'failed'$$, :'sam'),
  $$values ('message'::text, 'failed'::text, 5, 'BadDeviceToken'::text, 'Sam Lee'::text)$$, 'push log filtered by person');
select set_eq(format($$select email, status from public.admin_invite_log() where workspace_name = 'AR Alpha'$$),
  $$values ('ar-old@t.local'::text, 'expired'::text), ('ar-new@t.local', 'pending'), ('ar-sam@t.local', 'accepted')$$,
  'invite log statuses');
select results_eq(format('select id, status from public.admin_invite_log(%L)', :'sam'),
  format($$values (%L::uuid, 'accepted'::text)$$, :'inv_sam'), 'invite log filtered by person');
select results_eq(format('select workspace_id, first_name, last_name from public.admin_invite_log() where id = %L', :'inv_old'),
  format($$values (%L::uuid, 'Old'::text, 'Invite'::text)$$, :'ws_a'), 'invite log has what a resend needs');
select is((select count(*)::int from public.admin_push_log(null, 1)), 1, 'push log respects the limit');
reset role;

-- readonly sees masked emails everywhere (admin_list_admins is owner-only, so readonly never reaches it).
select tests.act_as_aal(:'ro', 'aal2');
select is((select count(*)::int from public.admin_people() where email like 'ar-%@t.local'), 0,
  'readonly: admin_people shows no full email');
select set_has('select user_id, email from public.admin_people()', format($$values (%L::uuid, 'ar…@t.local'::text)$$, :'sam'),
  'readonly: admin_people shows the masked email');
select is(public.admin_client(:'sam')->>'email', 'ar…@t.local', 'readonly: admin_client masks the email');
select is((select count(*)::int from public.admin_invite_log() where email like 'ar-%@t.local'), 0,
  'readonly: admin_invite_log shows no full email');
select ok(exists (select 1 from public.admin_invite_log() where id = :'inv_old' and email = 'ar…@t.local'),
  'readonly: admin_invite_log shows the masked email');
select throws_ok('select * from public.admin_audit()', '42501', 'admin: not authorised', 'readonly cannot read the audit log');
reset role;

-- support sees only own audit rows; the owner sees all.
select tests.act_as_aal(:'support', 'aal2');
select results_eq('select admin_name, action, target_name from public.admin_audit()',
  $$values ('Sue Port'::text, 'password_reset'::text, 'Sam Lee'::text)$$, 'support sees only own audit rows');
reset role;
select tests.act_as_aal(:'owner', 'aal2');
select set_has('select admin_name, action, target_name from public.admin_audit()',
  $$values ('Sue Port'::text, 'password_reset'::text, 'Sam Lee'::text), ('Olive Owner', 'set_admin', 'Sue Port')$$,
  'the owner sees every audit row');
reset role;

select * from finish();
rollback;
