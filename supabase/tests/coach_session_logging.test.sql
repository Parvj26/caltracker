-- Coach session logging (20261106004000_coach_session_logging.sql): a coach logs a client's workout from the
-- website, takes over a workout the client is logging, and only one person changes a workout at a time.
begin;
select plan(54);

-- Fixtures (as postgres)
select tests.create_user('cs-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('cs-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('cs-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('cs-a3@t.local', 'Client A3') as a3 \gset
select tests.create_user('cs-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('cs-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('CS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');

select tests.create_exercise(null, 'CS Builtin') as ex \gset
select tests.create_workout(:'ws_a', 'A1 Session', :'a1', '2026-11-06', :'ex') as w_a1 \gset
select tests.create_workout(:'ws_a', 'A2 Session', :'a2', '2026-11-06', :'ex') as w_a2 \gset
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
select is(public.take_over_workout_log(:'l3'), '{"revision": 1005, "status": "in_progress"}'::jsonb,
  'the coach takes over; the revision jumps above anything the phone has queued');
select is(public.take_over_workout_log(:'l3'), '{"revision": 1005, "status": "in_progress"}'::jsonb,
  'taking over again changes nothing');
select is((select logged_by from public.workout_logs where id = :'l3'), :'coach_a'::uuid, 'the coach logs it now');
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.cs_doc(:'l3', :'w_a2', 'in_progress', 6, true))->>'applied', 'false',
  'the phone''s next save is refused');
select tests.act_as(:'coach_a');
select is(public.coach_save_workout_log(:'a2', tests.cs_doc(:'l3', :'w_a2', 'completed', 1006, true))->>'applied', 'true',
  'the coach finishes the taken-over session');
select is(tests.cs_error(format('select public.take_over_workout_log(%L)', :'l3')), '23514 -',
  'a finished workout cannot be taken over');

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
select is(tests.cs_error(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_a', :'l1')),
  '42501 -', 'a finished log''s logged_by cannot change');
select lives_ok(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_a', :'log_a3'),
  'an in-progress log can pass to the workspace''s coach');

select * from finish();
rollback;
