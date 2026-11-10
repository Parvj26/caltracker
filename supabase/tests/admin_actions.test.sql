-- Admin support actions, the test notification and "View as" data
-- (docs/superpowers/specs/2026-11-09-admin-dashboard-design.md).
begin;
select plan(57);

select tests.create_user('aa-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('aa-support@t.local', 'Sue Port') as support \gset
select tests.create_user('aa-ro@t.local', 'Rita Reader') as ro \gset
select tests.create_user('aa-nobody@t.local', 'No Body') as nobody \gset
insert into public.admin_users (user_id, role)
values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');

select tests.create_user('aa-ann@t.local', 'Ann Coach') as ann \gset
select tests.create_workspace('AA Alpha', :'ann') as ws \gset
select tests.create_user('aa-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('aa-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('aa-lee@t.local', 'Lee Ray') as lee \gset
select tests.add_client(:'ws', :'lee');
update public.workspace_members set created_at = now() - interval '30 days' where user_id in (:'sam', :'kim');

-- Lee has data for "View as": today's workout (done), a meal, targets, a goal, a coach meal and a best.
select public.client_today(:'lee', :'ws') as lee_today \gset
select tests.create_workout(:'ws', 'AA Legs', :'lee', :'lee_today') as w_today \gset
select tests.create_log(:'ws', :'lee', :'w_today') as log_lee \gset
insert into public.meals (workspace_id, client_id, eaten_at, eaten_on, name, calories, protein_g)
values (:'ws', :'lee', now(), :'lee_today', 'AA Oats', 450, 20);
insert into public.nutrition_targets (workspace_id, client_id, calories, protein_g) values (:'ws', :'lee', 2200, 150);
insert into public.client_goals (workspace_id, client_id, goal) values (:'ws', :'lee', 'Run 10k');
insert into public.coach_meals (workspace_id, name, created_by) values (:'ws', 'AA Bowl', :'ann');
select tests.create_exercise(null, 'AA Squat') as squat \gset
insert into public.personal_records (client_id, workspace_id, exercise_id, kind, value_kg, reps, log_id, achieved_at)
values (:'lee', :'ws', :'squat', 'heaviest', 100, 5, :'log_lee', now());

select tests.create_invite(:'ws', 'aa-new@t.local', 'New Person', :'ann', 'tok-aa-new-0000000000000') as inv_new \gset
select tests.create_invite(:'ws', 'aa-lee@t.local', 'Lee Ray', :'ann', 'tok-aa-lee-0000000000000') as inv_done \gset
update public.client_invites set accepted_at = now(), accepted_by = :'lee' where id = :'inv_done';

select ok(not has_function_privilege('authenticated', 'private.remove_client_core(uuid, uuid, uuid)', 'execute'),
  'remove_client_core is not callable through the API');

-- readonly is denied for every action (and so are non-admins and aal1 support).
select tests.act_as_aal(:'ro', 'aal2');
select throws_ok(q, '42501', 'admin: not authorised', 'readonly denied: ' || q) from unnest(array[
  format('select public.admin_cancel_invite(%L)', :'inv_new'), format('select public.admin_remove_client(%L)', :'kim'),
  format('select public.admin_log_action(%L, %L, %L)', 'password_reset', :'kim', '{}'),
  format('select public.admin_send_test_push(%L)', :'kim'), format('select public.admin_view_as_snapshot(%L)', :'kim'),
  format('select public.admin_log_timeline_view(%L)', :'kim')]) q;
reset role;
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok(q, '42501', 'admin: not authorised', 'non-admin denied: ' || q) from unnest(array[
  format('select public.admin_cancel_invite(%L)', :'inv_new'), format('select public.admin_remove_client(%L)', :'kim'),
  format('select public.admin_log_action(%L, %L, %L)', 'password_reset', :'kim', '{}'),
  format('select public.admin_send_test_push(%L)', :'kim'), format('select public.admin_view_as_snapshot(%L)', :'kim'),
  format('select public.admin_log_timeline_view(%L)', :'kim')]) q;
reset role;
select tests.act_as_aal(:'support', 'aal1');
select throws_ok(q, '42501', 'admin: not authorised', 'aal1 support denied: ' || q) from unnest(array[
  format('select public.admin_cancel_invite(%L)', :'inv_new'), format('select public.admin_remove_client(%L)', :'kim'),
  format('select public.admin_log_action(%L, %L, %L)', 'password_reset', :'kim', '{}'),
  format('select public.admin_send_test_push(%L)', :'kim'), format('select public.admin_view_as_snapshot(%L)', :'kim'),
  format('select public.admin_log_timeline_view(%L)', :'kim')]) q;
reset role;
select is((select count(*)::int from public.admin_audit_log), 0, 'denied calls write no audit rows');

-- admin_remove_client leaves a past_clients row identical to a coach removal (twins Sam and Kim).
select tests.act_as(:'ann');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws', :'sam'), 'Ann removes Sam herself');
reset role;
select tests.act_as_aal(:'support', 'aal2');
select lives_ok(format('select public.admin_remove_client(%L)', :'kim'), 'support removes Kim');
select throws_ok(format('select public.admin_remove_client(%L)', :'kim'), 'P0002', 'admin: not a client',
  'someone with no coach cannot be removed');
reset role;
select results_eq(
  format($$select removed_by, joined_at, removed_at::date, split_part(email, '@', 2)
    from public.past_clients where user_id = %L$$, :'kim'),
  format($$select removed_by, joined_at, removed_at::date, split_part(email, '@', 2)
    from public.past_clients where user_id = %L$$, :'sam'),
  'admin_remove_client leaves the same past_clients record as a coach removal (removed by the workspace owner)');
select results_eq(format('select email, first_name, last_name from public.past_clients where user_id = %L', :'kim'),
  $$values ('aa-kim@t.local'::text, 'Kim'::text, 'Park'::text)$$, 'Kim''s name and email are kept');
select is((select count(*)::int from public.workspace_members where user_id = :'kim'), 0, 'Kim no longer has a membership');
select results_eq(format($$select admin_id, target_user_id, details from public.admin_audit_log where action = 'remove_client'$$),
  format($$values (%L::uuid, %L::uuid, '{"workspace_ids": ["%s"]}'::jsonb)$$, :'support', :'kim', :'ws'),
  'remove_client writes one audit row');

-- cancel only pending.
select tests.act_as_aal(:'support', 'aal2');
select lives_ok(format('select public.admin_cancel_invite(%L)', :'inv_new'), 'support cancels a pending invite');
select throws_ok(format('select public.admin_cancel_invite(%L)', :'inv_done'), 'P0002', 'admin: invite is not pending',
  'an accepted invite cannot be cancelled');
select throws_ok(format('select public.admin_cancel_invite(%L)', :'inv_new'), 'P0002', 'admin: invite is not pending',
  'cancelling twice reports not pending');
reset role;
select is((select count(*)::int from public.client_invites where id = :'inv_new'), 0, 'the pending invite is gone');
select is((select count(*)::int from public.client_invites where id = :'inv_done'), 1, 'the accepted invite is kept');
select results_eq($$select target_user_id, details - 'invite_id' from public.admin_audit_log where action = 'cancel_invite'$$,
  format($$values (null::uuid, '{"workspace_id": "%s", "email": "aa-new@t.local"}'::jsonb)$$, :'ws'),
  'cancel_invite writes one audit row');

-- test push row inserted.
select tests.act_as_aal(:'support', 'aal2');
select public.admin_send_test_push(:'lee') as push_id \gset
reset role;
select results_eq(format('select user_id, workspace_id, type, sent_at from public.push_outbox where id = %L', :'push_id'),
  format($$values (%L::uuid, %L::uuid, 'test'::text, null::timestamptz)$$, :'lee', :'ws'), 'test push row inserted');
select results_eq($$select target_user_id, details->>'push_id' from public.admin_audit_log where action = 'send_test_push'$$,
  format($$values (%L::uuid, %L::text)$$, :'lee', :'push_id'), 'send_test_push writes one audit row');
select throws_ok($$insert into public.push_outbox (user_id, type, group_key) values (gen_random_uuid(), 'nope', 'x')$$,
  '23514', null, 'other unknown types are still refused');

-- log_action: only password_reset and resend_invite.
select tests.act_as_aal(:'support', 'aal2');
select lives_ok(format('select public.admin_log_action(%L, %L, %L)', 'password_reset', :'lee', '{"email": "aa-lee@t.local"}'),
  'support logs a password reset');
select throws_ok(format('select public.admin_log_action(%L, %L, %L)', 'drop_everything', :'lee', '{}'), '22023',
  'admin: unknown action', 'log_action rejects unknown action');
reset role;
select results_eq($$select target_user_id, details from public.admin_audit_log where action = 'password_reset'$$,
  format($$values (%L::uuid, '{"email": "aa-lee@t.local"}'::jsonb)$$, :'lee'), 'password_reset writes one audit row');

-- view as snapshot keys: a client with data.
select tests.act_as_aal(:'support', 'aal2');
select public.admin_view_as_snapshot(:'lee') as snap \gset
select public.admin_view_as_snapshot(:'kim') as snap_removed \gset
select lives_ok(format('select public.admin_log_timeline_view(%L)', :'lee'), 'support opens Lee''s timeline');
reset role;
select is((select array_agg(k order by k) from jsonb_object_keys(:'snap'::jsonb) k),
  array['bests', 'coach', 'coach_meals', 'goal', 'meals_today', 'profile', 'recent_logs', 'targets', 'today', 'week'],
  'view as snapshot keys');
select is(:'snap'::jsonb->'profile', '{"name": "Lee Ray", "units": "lb"}'::jsonb, 'snapshot: profile');
select is(:'snap'::jsonb->'coach', '{"name": "Ann Coach"}'::jsonb, 'snapshot: coach');
select is(:'snap'::jsonb->'today', format('{"date": "%s", "workouts": [{"id": "%s", "name": "AA Legs", "status": "done"}]}',
  :'lee_today', :'w_today')::jsonb, 'snapshot: today''s workout');
select is(:'snap'::jsonb->'week', '{"done": 1, "planned": 1}'::jsonb, 'snapshot: this week');
select is((select jsonb_agg(e - 'finished_at' - 'duration_s') from jsonb_array_elements(:'snap'::jsonb->'recent_logs') e),
  format('[{"id": "%s", "title": "AA Legs", "volume": null}]', :'log_lee')::jsonb, 'snapshot: recent logs');
select is((:'snap'::jsonb->'recent_logs'->0->>'duration_s')::int, 3000, 'snapshot: log duration in seconds');
select is(:'snap'::jsonb->'meals_today', '[{"name": "AA Oats", "kcal": 450, "protein_g": 20}]'::jsonb, 'snapshot: meals today');
select is(:'snap'::jsonb->'targets', '{"kcal": 2200, "protein_g": 150}'::jsonb, 'snapshot: targets');
select is(:'snap'::jsonb->'goal', '{"text": "Run 10k", "target_date": null}'::jsonb, 'snapshot: goal');
select is((:'snap'::jsonb->>'coach_meals')::int, 1, 'snapshot: coach meals');
select is((select jsonb_agg(e - 'at') from jsonb_array_elements(:'snap'::jsonb->'bests') e),
  '[{"exercise": "AA Squat", "weight": 100, "reps": 5}]'::jsonb, 'snapshot: bests');

-- view as snapshot keys: a removed client with no coach.
select is(:'snap_removed'::jsonb - 'today',
  '{"profile": {"name": "Kim Park", "units": "lb"}, "coach": null, "week": {"done": 0, "planned": 0}, "recent_logs": [],
    "meals_today": [], "targets": null, "goal": null, "coach_meals": 0, "bests": []}'::jsonb,
  'snapshot for a removed client: coach null, empty arrays');
select is(:'snap_removed'::jsonb->'today'->'workouts', '[]'::jsonb, 'snapshot for a removed client: no workouts today');
select ok((:'snap_removed'::jsonb->'today'->>'date') is not null, 'snapshot for a removed client: today still has a date');

-- each action wrote one audit row with the right action.
select results_eq('select action, count(*)::int from public.admin_audit_log group by action order by action',
  $$values ('cancel_invite'::text, 1), ('log_timeline_view', 1), ('password_reset', 1), ('remove_client', 1),
    ('send_test_push', 1), ('view_as_snapshot', 2)$$,
  'each action writes one audit row with the right action');
select results_eq($$select target_user_id from public.admin_audit_log where action = 'log_timeline_view'$$,
  format($$values (%L::uuid)$$, :'lee'), 'the timeline view is logged against the client');

select * from finish();
rollback;
