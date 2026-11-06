-- Coach session logging (20261106004000_coach_session_logging.sql): a coach logs a client's workout from the
-- website, takes over a workout the client is logging, and only one person changes a workout at a time.
begin;
select plan(82);

-- Fixtures (as postgres)
select tests.create_user('cs-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cs-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('cs-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('cs-a3@t.local', 'Client A3') as a3 \gset
select tests.create_user('cs-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cs-staff-a@t.local', 'Staff A') as staff_a \gset
select tests.create_user('cs-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('CS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws_a', :'staff_a', 'staff');

select tests.create_exercise(null, 'CS Builtin') as ex \gset
select tests.create_workout(:'ws_a', 'A1 Session', :'a1', '2026-11-06', :'ex') as w_a1 \gset
select tests.create_workout(:'ws_a', 'A2 Session', :'a2', '2026-11-06', :'ex') as w_a2 \gset
select tests.create_workout(:'ws_a', 'A1 Second', :'a1', '2026-11-07', :'ex') as w_a1b \gset
select tests.create_workout(:'ws_a', 'A3 Session', :'a3', '2026-11-06', :'ex') as w_a3 \gset
select tests.create_workout(:'ws_b', 'B1 Session', :'b1', '2026-11-06', :'ex') as w_b1 \gset
-- A finished log of A2's, for the "belongs to someone else" case.
select tests.create_log(:'ws_a', :'a2') as log_a2_done \gset
-- An in-progress log of A3's, for the logged_by trigger.
select tests.create_log(:'ws_a', :'a3', :'w_a3', 'in_progress') as log_a3 \gset

-- A one-exercise doc with one set, done or not (rolled back with the test).
create function tests.cs_doc(id uuid, workout_id uuid, status text, revision int, done boolean, reps int default 8)
returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'workoutId', workout_id, 'name', 'Session', 'status', status,
    'startedAt', now() - interval '30 minutes',
    'finishedAt', case when status = 'completed' then to_jsonb(now()) else 'null'::jsonb end,
    'lastActivityAt', now() - interval '1 minute', 'autoFinished', false, 'revision', revision, 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', ('7c' || substr(id::text, 3))::uuid, 'kind', 'straight',
      'exercises', jsonb_build_array(jsonb_build_object('id', ('7e' || substr(id::text, 3))::uuid,
        'exerciseId', (select e.id from public.exercises e where e.name = 'CS Builtin'),
        'exerciseName', 'CS Builtin', 'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', null,
        'swappedFromExerciseId', null, 'note', null,
        'sets', jsonb_build_array(jsonb_build_object('id', ('75' || substr(id::text, 3))::uuid, 'setType', 'normal',
          'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 60, 'durationS', null,
            'distanceM', null, 'toFailure', false, 'restSeconds', 90),
          'actualReps', reps, 'actualWeightKg', 60, 'actualDurationS', null, 'actualDistanceM', null,
          'completedAt', case when done then to_jsonb(now() - interval '2 minutes') else 'null'::jsonb end)))))));
$$;
-- The SQLSTATE and hint a statement fails with.
create function tests.cs_error(sql text) returns text language plpgsql as $$
declare
  v_state text;
  v_hint text;
begin
  execute sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ' ' || coalesce(nullif(v_hint, ''), '-');
end;
$$;

\set l1 '6c000000-0000-4000-8000-000000000001'
\set l2 '6c000000-0000-4000-8000-000000000002'
\set l3 '6c000000-0000-4000-8000-000000000003'
\set l4 '6c000000-0000-4000-8000-000000000004'
\set lb '6c000000-0000-4000-8000-0000000000b1'

-- ---------------------------------------------------------------------------------------------
-- Function shape and privileges
select has_function('public', 'coach_save_workout_log', array['uuid', 'jsonb'], 'coach_save_workout_log exists');
select has_function('public', 'take_over_workout_log', array['uuid'], 'take_over_workout_log exists');
select has_function('public', 'coach_last_results', array['uuid', 'uuid[]'], 'coach_last_results exists');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.coach_save_workout_log(uuid, jsonb)'::regprocedure),
  'coach_save_workout_log is definer with an empty search_path');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.take_over_workout_log(uuid)'::regprocedure),
  'take_over_workout_log is definer with an empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.coach_last_results(uuid, uuid[])'::regprocedure), false,
  'coach_last_results is security invoker');
select ok(not has_function_privilege('anon', 'public.coach_save_workout_log(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.take_over_workout_log(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.coach_last_results(uuid, uuid[])', 'execute'),
  'anon can call none of the coach logging functions');
select ok(has_function_privilege('authenticated', 'public.coach_save_workout_log(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.take_over_workout_log(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.coach_last_results(uuid, uuid[])', 'execute'),
  'authenticated can call the coach logging functions');
select ok(not has_function_privilege('authenticated', 'private.save_workout_log_as(jsonb, uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.save_workout_log_as(jsonb, uuid, uuid)', 'execute')
  and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the shared save body cannot be called directly');
select ok((select prosrc from pg_proc where oid = 'public.save_workout_log(jsonb)'::regprocedure)
  like '%private.save_workout_log_as(p_doc, v_uid, v_uid)%', 'the phone''s save_workout_log uses the shared body');
select ok((select prosrc from pg_proc where oid = 'private.save_workout_log_as(jsonb, uuid, uuid)'::regprocedure)
  like '%substitute_options%', 'the shared body keeps the substitute checks');
select ok(has_function_privilege('authenticated', 'public.hand_back_workout_log(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.reclaim_workout_log(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.workout_log_logger(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hand_back_workout_log(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reclaim_workout_log(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.workout_log_logger(uuid)', 'execute'),
  'hand back, reclaim and the logger check are for signed-in users only');

-- ---------------------------------------------------------------------------------------------
-- The coach logs A1's planned workout
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l1', :'w_a1', 'in_progress', 1, false)),
  '{"applied": true, "revision": 1, "status": "in_progress"}'::jsonb, 'the coach starts a log for their client');
reset role;
select results_eq(
  format($$select client_id, workspace_id, workout_id, logged_by from public.workout_logs where id = %L$$, :'l1'),
  format($$values (%L::uuid, %L::uuid, %L::uuid, %L::uuid)$$, :'a1', :'ws_a', :'w_a1', :'coach_a'),
  'the log is the client''s, in their workspace, logged by the coach');
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l1', :'w_a1', 'in_progress', 2, true))->>'applied', 'true',
  'the coach keeps logging (a ticked set)');

-- The client cannot change a workout their coach is logging.
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cs_doc(:'l1', :'w_a1', 'in_progress', 3, true, 12)),
  '{"applied": false, "revision": 2, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the client''s save is refused while the coach logs');
select is((select actual_reps from public.log_sets where log_id = :'l1'), 8::smallint, 'the coach''s numbers stay');
select is((select logged_by from public.workout_logs where id = :'l1'), :'coach_a'::uuid,
  'the client sees who is logging it');
select is(tests.cs_error(format('select public.take_over_workout_log(%L)', :'l1')), '42501 -',
  'a client cannot take a workout over');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l1', :'w_a1', 'in_progress', 4, true))), '42501 -', 'a client cannot log as a coach for themselves');

-- Another client of the workspace cannot log as a coach either.
select tests.act_as(:'a2');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l1', :'w_a1', 'in_progress', 4, true))), '42501 -', 'a client cannot log for another client');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l2', :'w_a1', 'in_progress', 1, false))), '42501 -', 'a client cannot start a log for another client');

-- Another workspace's coach is refused everywhere.
select tests.act_as(:'coach_b');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l1', :'w_a1', 'in_progress', 4, true))), '42501 -', 'another workspace''s coach cannot change the log');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l2', :'w_a1', 'in_progress', 1, false))), '42501 -',
  'another workspace''s coach cannot start a log for the client');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l2', null, 'in_progress', 1, false))), '42501 -',
  'another workspace''s coach cannot start an unplanned log for the client');
select is(tests.cs_error(format('select public.take_over_workout_log(%L)', :'l1')), '42501 -',
  'another workspace''s coach cannot take the workout over');
select is((select count(*)::int from public.workout_logs where id = :'l1'), 0, 'another workspace''s coach cannot read it');
select is((select count(*)::int from public.coach_last_results(:'a1', array[:'ex'::uuid])), 0,
  'another workspace''s coach gets no last results');
-- Their own client still works for them.
select is(public.coach_save_workout_log(:'b1', tests.cs_doc(:'lb', :'w_b1', 'in_progress', 1, false))->>'applied', 'true',
  'coach B logs their own client');

-- The coach is held to the same rules as the phone.
select tests.act_as(:'coach_a');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l2', :'w_a2', 'in_progress', 1, false))), '42501 -', 'the plan must be the client''s');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'log_a2_done', :'w_a1', 'in_progress', 9, false))), '42501 -',
  'a log id of another client is refused');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'b1',
  tests.cs_doc(:'l2', :'w_b1', 'in_progress', 1, false))), '42501 -', 'another workspace''s client is refused');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'coach_a',
  tests.cs_doc(:'l2', :'w_a1', 'in_progress', 1, false))), '42501 -', 'a coach cannot log as their own client');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l1', :'w_a1', 'in_progress', 2, true)),
  '{"applied": false, "revision": 2, "status": "in_progress"}'::jsonb, 'a stale coach save is refused like the phone''s');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a1',
  tests.cs_doc(:'l1', :'w_a1', 'completed', 3, false))), '23514 -', 'finishing needs a done set, as on the phone');

-- The coach finishes: the log is locked for everyone, and counts like any finished workout.
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l1', :'w_a1', 'completed', 3, true))->>'status', 'completed',
  'the coach finishes the session');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l1', :'w_a1', 'in_progress', 4, true))->>'applied', 'false',
  'a finished session is locked for the coach too');
select is((select count(*)::int from public.coach_last_results(:'a1', array[:'ex'::uuid])), 1,
  'the coach sees the client''s last results');
select tests.act_as(:'a1');
select is((select status::text from public.workout_logs where id = :'l1'), 'completed', 'the client sees the finished log');
select is((select count(*)::int from public.last_results(array[:'ex'::uuid])), 1,
  'the coach''s session is the client''s "last time"');
select is((select count(*)::int from public.coach_last_results(:'a2', array[:'ex'::uuid])), 0,
  'a client gets nobody else''s last results');
reset role;
select is((public.award_inputs(:'l1') -> 'log' ->> 'client_id')::uuid, :'a1'::uuid,
  'the award is worked out for the client');
select ok(jsonb_path_exists(public.award_inputs(:'l1'), '$.logs[*] ? (@.id == $id)', jsonb_build_object('id', :'l1')),
  'the coach''s session is in the client''s award history');

-- ---------------------------------------------------------------------------------------------
-- Take over: A2 is logging on the phone, the coach takes over.
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.cs_doc(:'l3', :'w_a2', 'in_progress', 5, true))->>'applied', 'true',
  'the client logs on the phone');
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a2', tests.cs_doc(:'l3', :'w_a2', 'in_progress', 6, true)),
  '{"applied": false, "revision": 5, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the coach cannot change a workout the client is logging');
select is(public.take_over_workout_log(:'l3'), '{"revision": 5, "status": "in_progress"}'::jsonb,
  'the coach takes over; the revision stays the phone''s');
select is(public.take_over_workout_log(:'l3'), '{"revision": 5, "status": "in_progress"}'::jsonb,
  'taking over again changes nothing');
select is((select logged_by from public.workout_logs where id = :'l3'), :'coach_a'::uuid, 'the coach logs it now');
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.cs_doc(:'l3', :'w_a2', 'in_progress', 9, true)),
  '{"applied": false, "revision": 5, "status": "in_progress", "loggedByOther": true}'::jsonb,
  'the phone''s next save is refused, even with a higher revision, and says someone else logs it');
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a2', tests.cs_doc(:'l3', :'w_a2', 'completed', 6, true))->>'applied', 'true',
  'the coach finishes the taken-over session');
select is(tests.cs_error(format('select public.take_over_workout_log(%L)', :'l3')), '23514 -',
  'a finished workout cannot be taken over');

-- ---------------------------------------------------------------------------------------------
-- Hand back and reclaim: the coach logs A1's second workout, gives it back, takes it again and stops.
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l4', :'w_a1b', 'in_progress', 1, true))->>'applied', 'true',
  'the coach starts A1''s second workout');
select tests.act_as(:'a1');
select is(public.workout_log_logger(:'l4') - 'lastActivityAt',
  '{"status": "in_progress", "heldByOther": true, "canReclaim": false}'::jsonb,
  'the phone learns the coach holds it and cannot take it back yet');
select is(tests.cs_error(format('select public.reclaim_workout_log(%L)', :'l4')), '55000 -',
  'the client cannot take it back while the coach is active');
select is(tests.cs_error(format('select public.hand_back_workout_log(%L)', :'l4')), '42501 -', 'a client cannot hand back');
select tests.act_as(:'a2');
select is(public.workout_log_logger(:'l4'), null, 'another client learns nothing about it');
select is(tests.cs_error(format('select public.reclaim_workout_log(%L)', :'l4')), '42501 -',
  'another client cannot reclaim it');
select tests.act_as(:'coach_b');
select is(tests.cs_error(format('select public.hand_back_workout_log(%L)', :'l4')), '42501 -',
  'another workspace''s coach cannot hand it back');
select tests.act_as(:'staff_a');
select is(tests.cs_error(format('select public.hand_back_workout_log(%L)', :'l4')), '42501 -',
  'only the coach logging it hands it back');
select tests.act_as(:'coach_a');
select is(public.hand_back_workout_log(:'l4'), '{"revision": 1001, "status": "in_progress"}'::jsonb,
  'the coach hands it back; the revision jumps above anything an offline phone queued');
select is((select logged_by from public.workout_logs where id = :'l4'), :'a1'::uuid, 'the client logs it again');
select is(public.coach_save_workout_log(:'a1', tests.cs_doc(:'l4', :'w_a1b', 'in_progress', 1002, true))->>'loggedByOther',
  'true', 'the coach''s saves are refused after the hand back');
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.cs_doc(:'l4', :'w_a1b', 'in_progress', 7, true)),
  '{"applied": false, "revision": 1001, "status": "in_progress"}'::jsonb,
  'an offline phone''s older copy is refused as stale, so it adopts the coach''s sets');
select is(public.save_workout_log(tests.cs_doc(:'l4', :'w_a1b', 'in_progress', 1002, true))->>'applied', 'true',
  'the phone carries on from the server copy');
select is(public.workout_log_logger(:'l4') - 'lastActivityAt',
  '{"status": "in_progress", "heldByOther": false, "canReclaim": false}'::jsonb, 'the client holds it now');

-- The coach takes it again and goes quiet for 30 minutes: the client may take it back.
select tests.act_as(:'coach_a');
select is(public.take_over_workout_log(:'l4')->>'revision', '1002', 'the coach takes it again');
reset role;
update public.workout_logs set last_activity_at = now() - interval '30 minutes' where id = :'l4';
select tests.act_as(:'a1');
select is((public.workout_log_logger(:'l4') ->> 'canReclaim')::boolean, true,
  'after 20 minutes without the coach the client may take it back');
select is(public.reclaim_workout_log(:'l4'), '{"revision": 1002, "status": "in_progress"}'::jsonb, 'the client takes it back');
select is((select logged_by from public.workout_logs where id = :'l4'), :'a1'::uuid, 'the phone logs it again');
select is(public.reclaim_workout_log(:'l4')->>'revision', '1002', 'reclaiming one''s own log changes nothing');

-- Another coach of the workspace can take over a colleague's session; a removed staff coach's session can be
-- taken back by the client straight away.
select tests.act_as(:'staff_a');
select is(public.take_over_workout_log(:'l4')->>'status', 'in_progress', 'a staff coach takes it over');
select tests.act_as(:'coach_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l4'), 'another coach takes it from the staff coach');
select tests.act_as(:'staff_a');
select lives_ok(format('select public.take_over_workout_log(%L)', :'l4'), 'the staff coach takes it once more');
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'staff_a';
select tests.act_as(:'a1');
select is((public.workout_log_logger(:'l4') ->> 'canReclaim')::boolean, true,
  'a removed staff coach''s session can be taken back at once');
select lives_ok(format('select public.reclaim_workout_log(%L)', :'l4'), 'the client takes it back from a removed coach');

-- A removed client: the coach can neither log for them nor take their workout over.
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a3';
select tests.act_as(:'coach_a');
select is(tests.cs_error(format('select public.coach_save_workout_log(%L, %L::jsonb)', :'a3',
  tests.cs_doc(:'l2', :'w_a3', 'in_progress', 1, false))), '42501 not_a_client', 'a removed client cannot be logged for');
select is(tests.cs_error(format('select public.take_over_workout_log(%L)', :'log_a3')), '42501 not_a_client',
  'a removed client''s workout cannot be taken over');

-- ---------------------------------------------------------------------------------------------
-- logged_by changes only to a coach of the workspace, while in progress (as postgres: only the trigger refuses).
reset role;
select is(tests.cs_error(format('update public.workout_logs set logged_by = %L where id = %L', :'a1', :'log_a3')),
  '42501 -', 'logged_by cannot become another client');
select is(tests.cs_error(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_b', :'log_a3')),
  '42501 -', 'logged_by cannot become another workspace''s coach');
select is(tests.cs_error(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_a', :'log_a2_done')),
  '42501 -', 'a finished log''s logged_by cannot change');
select lives_ok(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_a', :'log_a3'),
  'an in-progress log can pass to the workspace''s coach');
select lives_ok(format('update public.workout_logs set logged_by = %L where id = %L', :'a3', :'log_a3'),
  'and back to its own client');

select * from finish();
rollback;
