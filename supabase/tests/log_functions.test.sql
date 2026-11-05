begin;
select plan(112);

-- Fixtures (as postgres)
select tests.create_user('lf-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('lf-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('lf-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('lf-a3@t.local', 'Client A3') as a3 \gset
select tests.create_user('lf-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('lf-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('LF Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('LF Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');

select tests.create_exercise(null, 'LF Builtin') as ex_bi \gset
select tests.create_exercise(null, 'LF Builtin Two') as ex_bi2 \gset
select tests.create_exercise(null, 'LF Builtin Three') as ex_bi3 \gset
select tests.create_exercise(:'ws_b', 'LF B Custom') as ex_b \gset

select tests.create_workout(:'ws_a', 'A1 Day', :'a1', '2026-11-10', :'ex_bi') as inst_a1 \gset
select tests.create_workout(:'ws_a', 'A2 Day', :'a2', '2026-11-10', :'ex_bi') as inst_a2 \gset
select tests.create_workout(:'ws_a', 'A3 Day', :'a3', '2026-11-10', :'ex_bi') as inst_a3 \gset
select tests.create_workout(:'ws_a', 'A Library', ex => :'ex_bi') as lib_a \gset
-- A finished log of A2's: its ids are the ones other clients try to reuse.
select tests.create_log(:'ws_a', :'a2') as log_a2 \gset
select id as log_a2_block from public.log_blocks where log_id = :'log_a2' \gset
select id as log_a2_le from public.log_exercises where log_id = :'log_a2' \gset
select id as log_a2_set from public.log_sets where log_id = :'log_a2' and position = 0 \gset
-- A scratch log for the owner-column trigger.
select tests.create_log(:'ws_a', :'a1') as log_scratch \gset
select id as scratch_block from public.log_blocks where log_id = :'log_scratch' \gset
select id as scratch_le from public.log_exercises where log_id = :'log_scratch' \gset
select id as scratch_set from public.log_sets where log_id = :'log_scratch' and position = 0 \gset
insert into public.workout_log_comments (log_id, body, author_id) values (:'log_scratch', 'Nice', :'coach_a')
  returning id as scratch_comment \gset

-- Doc builders (rolled back with the test).
create function tests.lg_set(id uuid, set_type text, reps int, kg numeric, done boolean,
  rest int default 90, to_failure boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'setType', set_type,
    'target', jsonb_build_object('repsMin', reps, 'repsMax', reps, 'weightKg', kg, 'durationS', null,
      'distanceM', null, 'toFailure', to_failure, 'restSeconds', rest),
    'actualReps', reps, 'actualWeightKg', kg, 'actualDurationS', null, 'actualDistanceM', null,
    'completedAt', case when done then to_jsonb(now() - interval '5 minutes') else 'null'::jsonb end);
$$;
create function tests.lg_ex(id uuid, exercise_id uuid, sets jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'exerciseId', exercise_id, 'exerciseName', 'ignored',
    'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', null, 'swappedFromExerciseId', null,
    'note', null, 'sets', sets);
$$;
create function tests.lg_block(id uuid, kind text, exercises jsonb) returns jsonb
language sql as $$ select jsonb_build_object('id', id, 'kind', kind, 'exercises', exercises); $$;
create function tests.lg_doc(id uuid, workout_id uuid, status text, revision int, blocks jsonb,
  auto_finished boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'workoutId', workout_id, 'name', 'Logged', 'status', status,
    'startedAt', now() - interval '1 hour', 'finishedAt', null, 'lastActivityAt', now() - interval '5 minutes',
    'autoFinished', auto_finished, 'revision', revision, 'notes', null, 'blocks', blocks);
$$;
-- One straight block, one exercise: the shape most cases need.
create function tests.lg_one(id uuid, workout_id uuid, status text, revision int, b uuid, e uuid, ex uuid, sets jsonb)
returns jsonb
language sql as $$
  select tests.lg_doc(id, workout_id, status, revision,
    jsonb_build_array(tests.lg_block(b, 'straight', jsonb_build_array(tests.lg_ex(e, ex, sets)))));
$$;

\set l1 '6b000000-0000-4000-8000-000000000001'
\set l2 '6b000000-0000-4000-8000-000000000002'
\set l3 '6b000000-0000-4000-8000-000000000003'
\set l4 '6b000000-0000-4000-8000-000000000004'
\set la2 '6b000000-0000-4000-8000-0000000000a2'
\set la3 '6b000000-0000-4000-8000-0000000000a3'
\set lb1 '6b000000-0000-4000-8000-0000000000b1'
\set lx '6b000000-0000-4000-8000-0000000000ff'
\set b1x '6b000000-0000-4000-8000-0000000001b1'
\set e1x '6b000000-0000-4000-8000-0000000001e1'
\set s1 '6b000000-0000-4000-8000-000000000501'
\set s2 '6b000000-0000-4000-8000-000000000502'
\set s3 '6b000000-0000-4000-8000-000000000503'
\set s4 '6b000000-0000-4000-8000-000000000504'
\set l3s2 '6b000000-0000-4000-8000-000000000351'
\set l5 '6b000000-0000-4000-8000-000000000005'
\set l5b '6b000000-0000-4000-8000-0000000005b0'
\set l5e '6b000000-0000-4000-8000-0000000005e0'
\set l5s '6b000000-0000-4000-8000-000000000550'
\set l6 '6b000000-0000-4000-8000-000000000006'
\set l6b '6b000000-0000-4000-8000-0000000006b0'
\set l6e '6b000000-0000-4000-8000-0000000006e0'
\set l6s '6b000000-0000-4000-8000-000000000650'
\set l7 '6b000000-0000-4000-8000-000000000007'
\set l7b '6b000000-0000-4000-8000-0000000007b0'
\set l7e '6b000000-0000-4000-8000-0000000007e0'
\set l7s '6b000000-0000-4000-8000-000000000750'
\set gb '6b000000-0000-4000-8000-0000000009b0'
\set ge '6b000000-0000-4000-8000-0000000009e0'
\set gs '6b000000-0000-4000-8000-000000000900'
\set gs2 '6b000000-0000-4000-8000-000000000901'
\set gone '6b000000-0000-4000-8000-00000000dead'
\set bb '6b000000-0000-4000-8000-000000000bb0'
\set be '6b000000-0000-4000-8000-000000000be0'
\set bs '6b000000-0000-4000-8000-000000000b50'
\set l3b '6b000000-0000-4000-8000-0000000003b0'
\set l3e '6b000000-0000-4000-8000-0000000003e0'
\set l3s '6b000000-0000-4000-8000-000000000350'
\set a2b '6b000000-0000-4000-8000-0000000a2b00'
\set a2e '6b000000-0000-4000-8000-0000000a2e00'
\set a2s '6b000000-0000-4000-8000-0000000a2500'
\set a2b2 '6b000000-0000-4000-8000-0000000a2b02'
\set a2e2 '6b000000-0000-4000-8000-0000000a2e02'
\set a2s2 '6b000000-0000-4000-8000-0000000a2502'
\set a3b '6b000000-0000-4000-8000-0000000a3b00'
\set a3e '6b000000-0000-4000-8000-0000000a3e00'
\set a3s '6b000000-0000-4000-8000-0000000a3500'

-- L1 for A1's instance. v1: a normal set (not done) and a drop with no rest timer.
select tests.lg_one(:'l1', :'inst_a1', 'in_progress', 1, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, false), tests.lg_set(:'s2', 'drop', null, null, false, null, true))) as l1_v1 \gset
-- v2: set 1 done.
select tests.lg_one(:'l1', :'inst_a1', 'in_progress', 2, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, true), tests.lg_set(:'s2', 'drop', null, null, false, null, true))) as l1_v2 \gset
-- v3: the drop removed, a new normal set added.
select tests.lg_one(:'l1', :'inst_a1', 'in_progress', 3, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, true), tests.lg_set(:'s3', 'normal', 8, 60, false))) as l1_v3 \gset
-- v4: finished with nothing done.
select tests.lg_one(:'l1', :'inst_a1', 'completed', 4, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, false), tests.lg_set(:'s3', 'normal', 8, 60, false))) as l1_empty_finish \gset
select tests.lg_one(:'l1', :'inst_a1', 'completed', 5, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, true), tests.lg_set(:'s3', 'normal', 8, 60, false))) as l1_finish \gset
select jsonb_set(:'l1_v3'::jsonb, '{revision}', '6') as l1_reopen6 \gset
-- v6: three completed sets (the phone kept going after the server finished it).
select tests.lg_one(:'l1', :'inst_a1', 'completed', 6, :'b1x', :'e1x', :'ex_bi', jsonb_build_array(
  tests.lg_set(:'s1', 'normal', 8, 60, true), tests.lg_set(:'s3', 'normal', 8, 60, true),
  tests.lg_set(:'s4', 'normal', 8, 60, true))) as l1_more6 \gset
select jsonb_set(jsonb_set(:'l1_more6'::jsonb, '{revision}', '7'), '{status}', '"in_progress"') as l1_reopen7 \gset
select jsonb_set(:'l1_more6'::jsonb, '{revision}', '8') as l1_finish8 \gset
select jsonb_set(:'l1_reopen7'::jsonb, '{revision}', '9') as l1_reopen9 \gset

-- Guard docs (a fresh log id each, so nothing collides with L1).
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'drop', null, null, false, 0))) as doc_lead_drop \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false), tests.lg_set(:'gs2', 'drop', null, null, false, 60)))
  as doc_drop_rest \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false, 90, true))) as doc_normal_failure \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false), tests.lg_set(:'gs', 'normal', 8, 60, false)))
  as doc_dup \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false), tests.lg_set(:'log_a2_set', 'normal', 8, 99, false)))
  as doc_stolen_set \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'log_a2_le', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_stolen_ex \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'log_a2_block', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_stolen_block \gset
select tests.lg_one(:'lx', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_b',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_foreign_ex \gset
select tests.lg_one(:'log_a2', null, 'in_progress', 99, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_a2_log_id \gset
select tests.lg_one(:'lx', :'inst_a2', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_a2_inst \gset
select tests.lg_one(:'lx', :'lib_a', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_library \gset
select tests.lg_one(:'l2', null, 'in_progress', 1, :'gb', :'ge', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false))) as doc_second_active \gset

-- ---------------------------------------------------------------------------------------------
-- Function shape and privileges
select has_function('public', 'save_workout_log', array['jsonb'], 'save_workout_log(jsonb) exists');
select has_function('public', 'correct_workout_log', array['uuid', 'jsonb'], 'correct_workout_log(uuid, jsonb) exists');
select has_function('public', 'last_results', array['uuid[]'], 'last_results(uuid[]) exists');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.save_workout_log(jsonb)'::regprocedure), 'save_workout_log is definer with an empty search_path');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.correct_workout_log(uuid, jsonb)'::regprocedure),
  'correct_workout_log is definer with an empty search_path');
select is((select prosecdef from pg_proc where oid = 'public.last_results(uuid[])'::regprocedure), false,
  'last_results is security invoker');
select ok(not has_function_privilege('anon', 'public.save_workout_log(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.correct_workout_log(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.last_results(uuid[])', 'execute'),
  'anon can call none of the log functions');
select ok(has_function_privilege('authenticated', 'public.save_workout_log(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.correct_workout_log(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.last_results(uuid[])', 'execute'),
  'authenticated can call the log functions');
select tests.act_as_anon();
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'l1_v1'), '42501', null,
  'anon calling save_workout_log gets 42501');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Owner and parent columns never change (as postgres, so only the trigger can refuse)
select throws_ok(format('update public.workout_logs set client_id = %L where id = %L', :'a2', :'log_scratch'),
  '42501', null, 'workout_logs.client_id cannot change');
select throws_ok(format('update public.workout_logs set workspace_id = %L where id = %L', :'ws_b', :'log_scratch'),
  '42501', null, 'workout_logs.workspace_id cannot change');
select throws_ok(format('update public.workout_logs set logged_by = %L where id = %L', :'coach_a', :'log_scratch'),
  '42501', null, 'workout_logs.logged_by cannot change to another user');
select throws_ok(format('update public.log_blocks set log_id = %L where id = %L', :'log_a2', :'scratch_block'),
  '42501', null, 'log_blocks.log_id cannot change');
select throws_ok(format('update public.log_blocks set client_id = %L where id = %L', :'a2', :'scratch_block'),
  '42501', null, 'log_blocks.client_id cannot change');
select throws_ok(format('update public.log_exercises set block_id = %L where id = %L', :'log_a2_block', :'scratch_le'),
  '42501', null, 'log_exercises.block_id cannot change');
select throws_ok(format('update public.log_exercises set workspace_id = %L where id = %L', :'ws_b', :'scratch_le'),
  '42501', null, 'log_exercises.workspace_id cannot change');
select throws_ok(format('update public.log_sets set log_exercise_id = %L where id = %L', :'log_a2_le', :'scratch_set'),
  '42501', null, 'log_sets.log_exercise_id cannot change');
select throws_ok(format('update public.log_sets set log_id = %L where id = %L', :'log_a2', :'scratch_set'),
  '42501', null, 'log_sets.log_id cannot change');
select throws_ok(format('update public.workout_log_comments set client_id = %L where id = %L', :'a2', :'scratch_comment'),
  '42501', null, 'workout_log_comments.client_id cannot change');
select throws_ok(format('update public.workout_log_comments set log_id = %L where id = %L', :'log_a2', :'scratch_comment'),
  '42501', null, 'workout_log_comments.log_id cannot change');
select lives_ok(format('update public.log_sets set actual_reps = 9 where id = %L', :'scratch_set'),
  'other set columns still update');
-- Deleting the logging account sets logged_by null (on delete set null), which must not be refused.
select lives_ok(format('update public.workout_logs set logged_by = null where id = %L', :'log_scratch'),
  'logged_by may become null when its account is deleted');

-- The new set rules are table checks too.
select throws_ok(format('update public.log_sets set set_type = ''drop'', rest_seconds = 60 where id = %L', :'scratch_set'),
  '23514', null, 'a drop with rest is refused by the table');
select throws_ok(format('update public.log_sets set to_failure = true where id = %L', :'scratch_set'),
  '23514', null, 'to failure on a normal set is refused by the table');

-- ---------------------------------------------------------------------------------------------
-- Insert and re-save
select tests.act_as(:'a1');
select is(public.save_workout_log(:'l1_v1'::jsonb), '{"applied": true, "revision": 1, "status": "in_progress"}'::jsonb,
  'a new in-progress doc is applied at revision 1');
reset role;
select results_eq(
  format($$select workspace_id, client_id, workout_id, logged_by, status::text, revision, name, finished_at
    from public.workout_logs where id = %L$$, :'l1'),
  format($$values (%L::uuid, %L::uuid, %L::uuid, %L::uuid, 'in_progress', 1, 'Logged', null::timestamptz)$$,
    :'ws_a', :'a1', :'inst_a1', :'a1'),
  'the log is stored for A1 in the plan''s workspace, logged by A1');
select is((select count(*)::int from public.log_blocks where log_id = :'l1'), 1, '1 block');
select is((select count(*)::int from public.log_exercises where log_id = :'l1'), 1, '1 exercise');
select results_eq(
  format($$select id, position::int, set_type::text, target_reps_min::int, target_weight_kg, to_failure,
    rest_seconds::int, completed_at is null from public.log_sets where log_exercise_id = %L order by position$$, :'e1x'),
  format($$values (%L::uuid, 0, 'normal', 8, 60.000::numeric(7,3), false, 90, true),
    (%L::uuid, 1, 'drop', null::int, null::numeric(7,3), true, null::int, true)$$, :'s1', :'s2'),
  'the sets are stored in order with their targets');
select is((select count(*)::int from public.log_sets where log_id = :'l1' and workspace_id = :'ws_a' and client_id = :'a1'),
  2, 'every set inherits the log''s workspace and client');

select tests.act_as(:'a1');
select is(public.save_workout_log(:'l1_v2'::jsonb), '{"applied": true, "revision": 2, "status": "in_progress"}'::jsonb,
  'revision 2 is applied');
select ok((select completed_at is not null and actual_reps = 8 and actual_weight_kg = 60
  from public.log_sets where id = :'s1'), 'the completed set is stored');
select is(public.save_workout_log(:'l1_v1'::jsonb), '{"applied": false, "revision": 2, "status": "in_progress"}'::jsonb,
  'a stale revision returns applied=false with the stored revision');
select ok((select completed_at is not null from public.log_sets where id = :'s1'), 'a stale revision changes nothing');
select is(public.save_workout_log(:'l1_v2'::jsonb), '{"applied": false, "revision": 2, "status": "in_progress"}'::jsonb,
  'the same revision again is not applied either');
select is(public.save_workout_log(:'l1_v3'::jsonb), '{"applied": true, "revision": 3, "status": "in_progress"}'::jsonb,
  'revision 3 is applied');
select results_eq(
  format($$select id, position::int from public.log_sets where log_id = %L order by position$$, :'l1'),
  format($$values (%L::uuid, 0), (%L::uuid, 1)$$, :'s1', :'s3'),
  'the removed drop is deleted and the new set takes its place');
reset role;
select lives_ok('set constraints all immediate', 'the saved positions satisfy the unique constraints');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- Set rules and doc guards (nothing is written)
select tests.act_as(:'a1');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_lead_drop'), '23514',
  'A drop set must follow a normal or warm-up set.', 'a leading drop is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_drop_rest'), '23514',
  'A drop set has no rest.', 'a drop with rest is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_normal_failure'), '23514',
  'Only drop sets can be "to failure".', 'to failure on a normal set is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_dup'), '23514',
  format('Row %s appears twice in the log.', :'gs'), 'a doc with a repeated id is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', jsonb_set(:'doc_lead_drop'::jsonb, '{revision}', '0')),
  '23514', 'Revision must be at least 1.', 'a new log with revision 0 is refused');

-- ---------------------------------------------------------------------------------------------
-- Inserting a finished or discarded log (a workout done with no signal)
select is(public.save_workout_log(tests.lg_one(:'l5', null, 'completed', 4, :'l5b', :'l5e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l5s', 'normal', 8, 50, true)))), '{"applied": true, "revision": 4, "status": "completed"}'::jsonb,
  'a new log can arrive already completed');
reset role;
select ok((select finished_at is not null and not auto_finished and revision = 4 from public.workout_logs where id = :'l5'),
  'the inserted completed log has finished_at set');
select is((select count(*)::int from public.log_sets where log_id = :'l5' and completed_at is not null), 1,
  'its completed set is stored');
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.lg_one(:'l6', null, 'discarded', 2, :'l6b', :'l6e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l6s', 'normal', 8, 50, false)))), '{"applied": true, "revision": 2, "status": "discarded"}'::jsonb,
  'a new log can arrive discarded');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', tests.lg_one(:'l7', null, 'completed', 1, :'l7b',
  :'l7e', :'ex_bi3', jsonb_build_array(tests.lg_set(:'l7s', 'normal', 8, 50, false)))), '23514',
  'Complete at least one set to finish.', 'a new completed log needs a completed set');

-- ---------------------------------------------------------------------------------------------
-- Status rules on L1 (revision 3, in progress)
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'l1_empty_finish'), '23514',
  'Complete at least one set to finish.', 'finishing with no completed sets is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_second_active'), '23505', null,
  'a second in-progress log for the same client is refused');
select is((select revision from public.workout_logs where id = :'l1'), 3, 'refused saves left L1 at revision 3');

select is(public.save_workout_log(:'l1_finish'::jsonb), '{"applied": true, "revision": 5, "status": "completed"}'::jsonb,
  'finishing with a completed set is applied');
select ok((select finished_at is not null and not auto_finished from public.workout_logs where id = :'l1'),
  'finishing always sets finished_at, even when the doc has none');
select is(public.save_workout_log(:'l1_reopen6'::jsonb), '{"applied": false, "revision": 5, "status": "completed"}'::jsonb,
  'a manually completed log is locked: a higher revision returns applied=false');
select is(public.save_workout_log(:'l1_more6'::jsonb), '{"applied": false, "revision": 5, "status": "completed"}'::jsonb,
  'a manually completed log is locked to a higher-revision completed doc too');
select is((select status::text from public.workout_logs where id = :'l1'), 'completed', 'the locked log is unchanged');

-- The server auto-finished it (simulated) while the phone kept logging.
reset role;
update public.workout_logs set auto_finished = true, finished_at = now() - interval '1 hour' where id = :'l1';
select tests.act_as(:'a1');
select is(public.save_workout_log(:'l1_more6'::jsonb), '{"applied": true, "revision": 6, "status": "completed"}'::jsonb,
  'after an auto-finish, the phone''s higher-revision doc is applied');
select is((select count(*)::int from public.log_sets where log_id = :'l1' and completed_at is not null), 3,
  'the sets the phone added after the auto-finish are stored');
select is((select auto_finished from public.workout_logs where id = :'l1'), true,
  'a completed -> completed save keeps auto_finished');
select is(public.save_workout_log(:'l1_reopen7'::jsonb), '{"applied": true, "revision": 7, "status": "in_progress"}'::jsonb,
  'an auto-finished log can be reopened within 24 h');
select is((select auto_finished from public.workout_logs where id = :'l1'), true, 'a reopen keeps auto_finished');
select is(public.save_workout_log(:'l1_finish8'::jsonb), '{"applied": true, "revision": 8, "status": "completed"}'::jsonb,
  'the reopened log finishes again');
select is((select auto_finished from public.workout_logs where id = :'l1'), false,
  'finishing from in progress takes auto_finished from the doc');

reset role;
update public.workout_logs set auto_finished = true, finished_at = now() - interval '25 hours' where id = :'l1';
select tests.act_as(:'a1');
select is(public.save_workout_log(:'l1_reopen9'::jsonb), '{"applied": false, "revision": 8, "status": "completed"}'::jsonb,
  'an auto-finished log is locked after 24 h');

-- Discarded: manual is final, automatic is not.
select is(public.save_workout_log(tests.lg_one(:'l3', null, 'in_progress', 1, :'l3b', :'l3e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l3s', 'normal', 8, 50, true)))), '{"applied": true, "revision": 1, "status": "in_progress"}'::jsonb,
  'an unplanned log is saved in the client''s only workspace');
select is((select workspace_id from public.workout_logs where id = :'l3'), :'ws_a'::uuid,
  'the unplanned log is in workspace A');
select is(public.save_workout_log(tests.lg_one(:'l3', null, 'discarded', 2, :'l3b', :'l3e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l3s', 'normal', 8, 50, true)))), '{"applied": true, "revision": 2, "status": "discarded"}'::jsonb,
  'an in-progress log can be discarded');
select is(public.save_workout_log(tests.lg_one(:'l3', null, 'in_progress', 3, :'l3b', :'l3e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l3s', 'normal', 8, 50, true)))), '{"applied": false, "revision": 2, "status": "discarded"}'::jsonb,
  'a manually discarded log is locked');
reset role;
update public.workout_logs set auto_finished = true, last_activity_at = now() - interval '1 hour' where id = :'l3';
select tests.act_as(:'a1');
select is(public.save_workout_log(tests.lg_one(:'l3', null, 'completed', 3, :'l3b', :'l3e', :'ex_bi3',
  jsonb_build_array(tests.lg_set(:'l3s', 'normal', 8, 50, true), tests.lg_set(:'l3s2', 'normal', 8, 50, true)))),
  '{"applied": true, "revision": 3, "status": "completed"}'::jsonb,
  'after an auto-discard, the phone''s higher-revision doc is applied');
select ok((select finished_at is not null and auto_finished from public.workout_logs where id = :'l3'),
  'the formerly auto-discarded log is completed with finished_at, keeping auto_finished');

-- ---------------------------------------------------------------------------------------------
-- Authorization and hijacked ids
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_a2_inst'), '42501', null,
  'A1 cannot log against A2''s instance');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_library'), '42501', null,
  'A1 cannot log against a library workout');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_a2_log_id'), '42501', null,
  'A1 cannot save over A2''s log id');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_stolen_set'), '23514',
  format('Row %s belongs to another log.', :'log_a2_set'), 'a set id from another log is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_stolen_ex'), '23514',
  format('Row %s belongs to another log.', :'log_a2_le'), 'an exercise id from another log is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_stolen_block'), '23514',
  format('Row %s belongs to another log.', :'log_a2_block'), 'a block id from another log is refused');
select throws_ok(format('select public.save_workout_log(%L::jsonb)', :'doc_foreign_ex'), '42501', null,
  'an exercise from another workspace is refused');
reset role;
select results_eq(
  format($$select log_id, client_id, actual_weight_kg from public.log_sets where id = %L$$, :'log_a2_set'),
  format($$values (%L::uuid, %L::uuid, 60.000::numeric(7,3))$$, :'log_a2', :'a2'),
  'the other log''s set is unchanged');
select is((select count(*)::int from public.workout_logs where id in (:'lx', :'log_a2') and client_id = :'a1'), 0,
  'no refused doc left a log behind for A1');

select tests.act_as(:'b1');
select throws_ok(format('select public.save_workout_log(%L::jsonb)',
  tests.lg_one(:'lb1', :'inst_a1', 'in_progress', 1, :'gb', :'ge', :'ex_bi',
    jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false)))), '42501', null,
  'B1 cannot log against workspace A''s workout');
reset role;

select tests.act_as(:'coach_a');
select throws_ok(format('select public.save_workout_log(%L::jsonb)',
  tests.lg_one(:'l4', null, 'in_progress', 1, :'gb', :'ge', :'ex_bi',
    jsonb_build_array(tests.lg_set(:'gs', 'normal', 8, 60, false)))), '42501', null,
  'a coach is not a client and cannot log for themselves');
reset role;

-- A3 finishes a workout (auto-finished, so still changeable), sees it in last_results, then is removed.
select tests.act_as(:'a3');
select is(public.save_workout_log(tests.lg_doc(:'la3', :'inst_a3', 'completed', 1, jsonb_build_array(
  tests.lg_block(:'a3b', 'straight', jsonb_build_array(tests.lg_ex(:'a3e', :'ex_bi', jsonb_build_array(
    tests.lg_set(:'a3s', 'normal', 8, 60, true)))))), true)), '{"applied": true, "revision": 1, "status": "completed"}'::jsonb,
  'A3 saves a finished log while a client');
select is((select count(*)::int from public.last_results(array[:'ex_bi']::uuid[])), 1,
  'while a client, A3 sees their last result');
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a3';
select tests.act_as(:'a3');
select throws_ok(format('select public.save_workout_log(%L::jsonb)',
  tests.lg_one(:'la3', :'inst_a3', 'in_progress', 2, :'a3b', :'a3e', :'ex_bi',
    jsonb_build_array(tests.lg_set(:'a3s', 'normal', 8, 60, true)))), '42501', null,
  'a removed client cannot save their log');
select throws_ok(format('select public.save_workout_log(%L::jsonb)',
  tests.lg_one(:'l4', null, 'in_progress', 1, :'b1x', :'e1x', :'ex_bi',
    jsonb_build_array(tests.lg_set(:'s1', 'normal', 8, 60, false)))), '42501', null,
  'a removed client cannot start an unplanned log');
reset role;
select is((select revision from public.workout_logs where id = :'la3'), 1, 'the removed client''s log is unchanged');

-- ---------------------------------------------------------------------------------------------
-- Plan changes mid-session
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.lg_one(:'la2', :'inst_a2', 'in_progress', 1, :'a2b', :'a2e', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'a2s', 'normal', 8, 60, false)))), '{"applied": true, "revision": 1, "status": "in_progress"}'::jsonb,
  'A2 starts a log for their instance');
reset role;
update public.workout_sets set target_weight_kg = 100 where workout_id = :'inst_a2';
select is((select target_weight_kg from public.log_sets where id = :'a2s'), 60.000::numeric(7,3),
  'editing the plan''s target leaves the log''s target unchanged');
delete from public.workouts where id = :'inst_a2';
select results_eq(format($$select workout_id, revision from public.workout_logs where id = %L$$, :'la2'),
  $$values (null::uuid, 1)$$, 'deleting the plan keeps the log with workout_id null');
select tests.act_as(:'a2');
select is(public.save_workout_log(tests.lg_one(:'la2', :'inst_a2', 'in_progress', 2, :'a2b', :'a2e', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'a2s', 'normal', 8, 60, true)))), '{"applied": true, "revision": 2, "status": "in_progress"}'::jsonb,
  'a retry that still names the deleted plan saves');
select is((select workout_id from public.workout_logs where id = :'la2'), null::uuid, 'the log stays unlinked');
-- Revision 3 moves the set into a new exercise in a new block; the old exercise gets a new set.
select is(public.save_workout_log(tests.lg_doc(:'la2', :'inst_a2', 'in_progress', 3, jsonb_build_array(
  tests.lg_block(:'a2b', 'straight', jsonb_build_array(tests.lg_ex(:'a2e', :'ex_bi', jsonb_build_array(
    tests.lg_set(:'a2s2', 'normal', 5, 40, false))))),
  tests.lg_block(:'a2b2', 'straight', jsonb_build_array(tests.lg_ex(:'a2e2', :'ex_bi2', jsonb_build_array(
    tests.lg_set(:'a2s', 'normal', 8, 60, true)))))))), '{"applied": true, "revision": 3, "status": "in_progress"}'::jsonb,
  'a set can move to another exercise of the same log');
reset role;
select results_eq(
  format($$select log_exercise_id, completed_at is not null from public.log_sets where id = %L$$, :'a2s'),
  format($$values (%L::uuid, true)$$, :'a2e2'), 'the moved set is under its new exercise and still completed');
select is((select count(*)::int from public.log_sets where log_id = :'la2'), 2, 'the log has exactly its 2 sets');

-- A first upload whose plan was deleted before it reached the server.
select tests.act_as(:'b1');
select is(public.save_workout_log(tests.lg_one(:'lb1', :'gone', 'in_progress', 1, :'bb', :'be', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'bs', 'normal', 8, 60, false)))), '{"applied": true, "revision": 1, "status": "in_progress"}'::jsonb,
  'a first upload naming a plan that no longer exists still saves');
reset role;
select results_eq(format($$select workspace_id, workout_id from public.workout_logs where id = %L$$, :'lb1'),
  format($$values (%L::uuid, null::uuid)$$, :'ws_b'), 'it is saved unlinked in the client''s only workspace');
select tests.act_as(:'b1');
select is(public.save_workout_log(tests.lg_one(:'lb1', :'gone', 'completed', 2, :'bb', :'be', :'ex_bi',
  jsonb_build_array(tests.lg_set(:'bs', 'normal', 5, 30, true)))), '{"applied": true, "revision": 2, "status": "completed"}'::jsonb,
  'B1 finishes their log');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Corrections. L1 is completed at revision 8; make it auto-finished within 24 h, so only the correction locks it.
update public.workout_logs set auto_finished = true, finished_at = now() - interval '1 hour' where id = :'l1';
select tests.act_as(:'coach_a');
select is(public.correct_workout_log(:'l1', jsonb_build_array(
  jsonb_build_object('id', :'s1', 'actualReps', 10, 'actualWeightKg', 62.5, 'actualDurationS', null,
    'actualDistanceM', null))), 1, 'a correction returns the number of sets updated');
reset role;
select results_eq(format($$select actual_reps::int, actual_weight_kg from public.log_sets where id = %L$$, :'s1'),
  $$values (10, 62.500::numeric(7,3))$$, 'the corrected actuals are stored');
select results_eq(
  format($$select corrected_by, corrected_at is not null, revision from public.workout_logs where id = %L$$, :'l1'),
  format($$values (%L::uuid, true, 8)$$, :'coach_a'), 'the log records who corrected it and its revision is unchanged');

select tests.act_as(:'coach_b');
select throws_ok(format('select public.correct_workout_log(%L, %L::jsonb)', :'l1',
  jsonb_build_array(jsonb_build_object('id', :'s1', 'actualReps', 1))), '42501', null, 'coach B cannot correct A''s log');
reset role;
select tests.act_as(:'a1');
select throws_ok(format('select public.correct_workout_log(%L, %L::jsonb)', :'l1',
  jsonb_build_array(jsonb_build_object('id', :'s1', 'actualReps', 1))), '42501', null, 'a client cannot correct');
reset role;
select tests.act_as(:'coach_a');
select throws_ok(format('select public.correct_workout_log(%L, %L::jsonb)', :'la2',
  jsonb_build_array(jsonb_build_object('id', :'a2s', 'actualReps', 1))), '23514',
  'Only finished workouts can be corrected.', 'an in-progress log cannot be corrected');
select throws_ok(format('select public.correct_workout_log(%L, %L::jsonb)', :'l1',
  jsonb_build_array(jsonb_build_object('id', :'log_a2_set', 'actualReps', 1))), '23514',
  format('Row %s belongs to another log.', :'log_a2_set'), 'a correction cannot touch another log''s set');
select throws_ok(format('select public.correct_workout_log(%L, %L::jsonb)', :'log_a2', '[]'), '23514',
  'Nothing to correct.', 'an empty correction is refused');
select throws_ok(format('select public.correct_workout_log(%L, null)', :'log_a2'), '23514',
  'Nothing to correct.', 'a missing correction is refused');
reset role;
select results_eq(format($$select actual_reps::int, corrected_at, corrected_by from public.log_sets s
    join public.workout_logs l on l.id = s.log_id where s.id = %L$$, :'log_a2_set'),
  $$values (8, null::timestamptz, null::uuid)$$, 'refused corrections changed and stamped nothing');

select tests.act_as(:'a1');
select is(public.save_workout_log(:'l1_reopen9'::jsonb), '{"applied": false, "revision": 8, "status": "completed"}'::jsonb,
  'a corrected auto-finished log is locked: the phone gets applied=false');
select is((select actual_reps::int from public.log_sets where id = :'s1'), 10, 'the correction is kept');
reset role;

-- ---------------------------------------------------------------------------------------------
-- last_results
-- An older finished log of A1's with the same exercise, and A2's newer finished log with it too.
select tests.create_log(:'ws_a', :'a1') as log_a1_old \gset
update public.log_exercises set exercise_id = :'ex_bi' where log_id = :'log_a1_old';
update public.workout_logs set finished_at = now() - interval '10 days' where id = :'log_a1_old';
update public.log_exercises set exercise_id = :'ex_bi' where log_id = :'log_a2';

select tests.act_as(:'a1');
select results_eq(
  format($$select exercise_id, finished_at, set_type::text, actual_reps::int, actual_weight_kg, position::int
    from public.last_results(array[%L, %L]::uuid[])$$, :'ex_bi', :'ex_bi2'),
  format($$select %L::uuid, l.finished_at, 'normal', v.reps, v.kg, v.pos from public.workout_logs l,
    (values (10, 62.500::numeric(7,3), 0), (8, 60.000, 1), (8, 60.000, 2)) v(reps, kg, pos) where l.id = %L
    order by v.pos$$, :'ex_bi', :'l1'),
  'last_results returns the completed sets of A1''s newest finished log only, not A2''s newer one');
reset role;
select tests.act_as(:'b1');
select results_eq(
  format($$select exercise_id, finished_at, actual_reps::int, actual_weight_kg from public.last_results(array[%L]::uuid[])$$,
    :'ex_bi'),
  format($$select %L::uuid, finished_at, 5, 30.000::numeric(7,3) from public.workout_logs where id = %L$$, :'ex_bi', :'lb1'),
  'B1 gets only their own result, none of workspace A''s');
reset role;
select tests.act_as(:'a3');
select is((select count(*)::int from public.last_results(array[:'ex_bi']::uuid[])), 0,
  'a removed client no longer gets their result');
reset role;

select * from finish();
rollback;
