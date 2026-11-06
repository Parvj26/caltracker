begin;
select plan(73);

-- Fixtures (as postgres)
select tests.create_user('sw-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('sw-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('sw-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('SW Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('SW Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');

select tests.create_exercise(null, 'SW Builtin') as ex_bi \gset
select tests.create_exercise(:'ws_a', 'SW A Custom') as ex_a \gset

select tests.create_workout(:'ws_a', 'SW A Library', ex => :'ex_a') as lib_a \gset
select tests.create_workout(:'ws_a', 'SW A1 Day', :'a1', '2026-11-10', :'ex_a') as inst_a1 \gset
select tests.create_workout(:'ws_b', 'SW B Library') as lib_b \gset
-- The instance was copied from the library workout.
update public.workouts set source_workout_id = :'lib_a' where id = :'inst_a1';

select id as lib_a_set0 from public.workout_sets where workout_id = :'lib_a' and position = 0 \gset
select id as lib_a_block from public.workout_blocks where workout_id = :'lib_a' \gset
select id as inst_block from public.workout_blocks where workout_id = :'inst_a1' \gset
select id as inst_we from public.workout_exercises where workout_id = :'inst_a1' \gset
select id as inst_set0 from public.workout_sets where workout_id = :'inst_a1' and position = 0 \gset
select id as inst_set1 from public.workout_sets where workout_id = :'inst_a1' and position = 1 \gset

-- Doc builders (rolled back with the test).
create function tests.sw_set(id uuid, set_type text, reps int default null, kg numeric default null,
  rest int default 90, to_failure boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'setType', set_type, 'targetRepsMin', reps, 'targetRepsMax', reps,
    'targetWeightKg', kg, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', to_failure,
    'restSeconds', rest, 'note', null);
$$;
create function tests.sw_ex(id uuid, exercise_id uuid, sets jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'exerciseId', exercise_id, 'exerciseName', 'ignored',
    'trackingType', 'weight_reps', 'note', null, 'sets', sets);
$$;
create function tests.sw_block(id uuid, kind text, exercises jsonb) returns jsonb
language sql as $$ select jsonb_build_object('id', id, 'kind', kind, 'exercises', exercises); $$;
create function tests.sw_doc(id uuid, name text, blocks jsonb) returns jsonb
language sql as $$ select jsonb_build_object('id', id, 'name', name, 'notes', 'Go heavy', 'blocks', blocks); $$;

\set w1 '5a000000-0000-4000-8000-000000000001'
\set b1 '5a000000-0000-4000-8000-0000000000b1'
\set b2 '5a000000-0000-4000-8000-0000000000b2'
\set e1 '5a000000-0000-4000-8000-0000000000e1'
\set e2 '5a000000-0000-4000-8000-0000000000e2'
\set e3 '5a000000-0000-4000-8000-0000000000e3'
\set s1 '5a000000-0000-4000-8000-000000000501'
\set s2 '5a000000-0000-4000-8000-000000000502'
\set s3 '5a000000-0000-4000-8000-000000000503'
\set s4 '5a000000-0000-4000-8000-000000000504'
\set s5 '5a000000-0000-4000-8000-000000000505'
\set s6 '5a000000-0000-4000-8000-000000000506'
\set s7 '5a000000-0000-4000-8000-000000000507'
\set s8 '5a000000-0000-4000-8000-000000000508'
\set s9 '5a000000-0000-4000-8000-000000000509'
\set s10 '5a000000-0000-4000-8000-000000000510'
\set snew '5a000000-0000-4000-8000-000000000599'

-- Doc 1: a straight block (3 normal sets + 1 drop) then a 2-exercise superset x 3 rounds.
select tests.sw_doc(:'w1', 'Upper A', jsonb_build_array(
  tests.sw_block(:'b1', 'straight', jsonb_build_array(
    tests.sw_ex(:'e1', :'ex_bi', jsonb_build_array(
      tests.sw_set(:'s1', 'normal', 8, 60), tests.sw_set(:'s2', 'normal', 8, 60),
      tests.sw_set(:'s3', 'normal', 8, 60), tests.sw_set(:'s4', 'drop', null, null, 0, true))))),
  tests.sw_block(:'b2', 'superset', jsonb_build_array(
    tests.sw_ex(:'e2', :'ex_a', jsonb_build_array(
      tests.sw_set(:'s5', 'normal', 10, 20), tests.sw_set(:'s6', 'normal', 10, 20), tests.sw_set(:'s7', 'normal', 10, 20))),
    tests.sw_ex(:'e3', :'ex_bi', jsonb_build_array(
      tests.sw_set(:'s8', 'normal', 12), tests.sw_set(:'s9', 'normal', 12), tests.sw_set(:'s10', 'normal', 12)))))
)) as doc1 \gset

-- Doc 2: blocks swapped, set 3 removed, set 5's weight changed.
select tests.sw_doc(:'w1', 'Upper A v2', jsonb_build_array(
  tests.sw_block(:'b2', 'superset', jsonb_build_array(
    tests.sw_ex(:'e2', :'ex_a', jsonb_build_array(
      tests.sw_set(:'s5', 'normal', 10, 22.5), tests.sw_set(:'s6', 'normal', 10, 20), tests.sw_set(:'s7', 'normal', 10, 20))),
    tests.sw_ex(:'e3', :'ex_bi', jsonb_build_array(
      tests.sw_set(:'s8', 'normal', 12), tests.sw_set(:'s9', 'normal', 12), tests.sw_set(:'s10', 'normal', 12))))),
  tests.sw_block(:'b1', 'straight', jsonb_build_array(
    tests.sw_ex(:'e1', :'ex_bi', jsonb_build_array(
      tests.sw_set(:'s1', 'normal', 8, 60), tests.sw_set(:'s2', 'normal', 8, 60),
      tests.sw_set(:'s4', 'drop', null, null, 0, true)))))
)) as doc2 \gset

-- The instance, edited: renamed, set 0 heavier, a new normal set added at the end.
select tests.sw_doc(:'inst_a1', 'A1 Day (edited)', jsonb_build_array(
  tests.sw_block(:'inst_block', 'straight', jsonb_build_array(
    tests.sw_ex(:'inst_we', :'ex_a', jsonb_build_array(
      tests.sw_set(:'inst_set0', 'normal', 8, 70), tests.sw_set(:'inst_set1', 'drop', null, null, 0, true),
      tests.sw_set(:'snew', 'normal', 6, 70))))))) as doc_inst \gset
-- The same doc under a new name: what client A1 tries to save. A name that differs from the stored one means a
-- save that wrongly went through would show.
select jsonb_set(:'doc_inst'::jsonb, '{name}', '"A1 renamed by client"') as doc_inst_client \gset

-- A one-block doc with one exercise, for the guard cases.
\set gw '5a000000-0000-4000-8000-000000000002'
\set gb '5a000000-0000-4000-8000-0000000000b9'
\set ge '5a000000-0000-4000-8000-0000000000e9'
\set ge2 '5a000000-0000-4000-8000-0000000000ea'
\set gs '5a000000-0000-4000-8000-000000000909'
\set gs2 '5a000000-0000-4000-8000-00000000090a'
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'drop', null, null, 0, true))))))) as doc_lead_drop \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'superset', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8))))))) as doc_short_superset \gset
select tests.sw_doc(:'gw', 'Guard', '[]'::jsonb) as doc_no_blocks \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8))),
  tests.sw_ex(:'ge2', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs2', 'normal', 8))))))) as doc_wide_straight \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', '[]'::jsonb))))) as doc_no_sets \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8), tests.sw_set(:'lib_a_set0', 'normal', 8)))))))
  as doc_stolen_set \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'lib_a_block', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8)))))))
  as doc_stolen_block \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8), tests.sw_set(:'gs', 'normal', 8)))))))
  as doc_dup_id \gset
select tests.sw_doc(:'lib_b', 'Into B', jsonb_build_array(tests.sw_block(:'gb', 'straight', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8))))))) as doc_b_id \gset

-- ---------------------------------------------------------------------------------------------
-- Function shape and privileges
select has_function('public', 'save_workout', array['uuid', 'jsonb'], 'save_workout(uuid, jsonb) exists');
select is((select prosecdef from pg_proc where oid = 'public.save_workout(uuid, jsonb)'::regprocedure), false,
  'save_workout is security invoker');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.save_workout(uuid, jsonb)'::regprocedure),
  'save_workout pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.save_workout(uuid, jsonb)', 'execute'), 'anon cannot call save_workout');
select ok(has_function_privilege('authenticated', 'public.save_workout(uuid, jsonb)', 'execute'),
  'authenticated can call save_workout');

-- ---------------------------------------------------------------------------------------------
-- Coach A saves a new doc
select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', :'doc1'::jsonb), :'w1'::uuid, 'save_workout returns the workout id');
select results_eq(
  format($$select workspace_id, client_id, scheduled_on, name, notes from public.workouts where id = %L$$, :'w1'),
  format($$values (%L::uuid, null::uuid, null::date, 'Upper A', 'Go heavy')$$, :'ws_a'),
  'a new doc becomes a library workout in the workspace');
select is((select count(*)::int from public.workout_blocks where workout_id = :'w1'), 2, '2 blocks');
select is((select count(*)::int from public.workout_exercises where workout_id = :'w1'), 3, '3 exercises');
select is((select count(*)::int from public.workout_sets where workout_id = :'w1'), 10, '10 sets');
select results_eq(
  format($$select id, position::int, kind::text from public.workout_blocks where workout_id = %L order by position$$, :'w1'),
  format($$values (%L::uuid, 0, 'straight'), (%L::uuid, 1, 'superset')$$, :'b1', :'b2'),
  'blocks are stored at 0-based positions in doc order');
select results_eq(
  format($$select id, block_id, position::int, exercise_id from public.workout_exercises where workout_id = %L
    order by block_id, position$$, :'w1'),
  format($$values (%L::uuid, %L::uuid, 0, %L::uuid), (%L::uuid, %L::uuid, 0, %L::uuid), (%L::uuid, %L::uuid, 1, %L::uuid)$$,
    :'e1', :'b1', :'ex_bi', :'e2', :'b2', :'ex_a', :'e3', :'b2', :'ex_bi'),
  'exercises belong to their blocks at 0-based positions');
select results_eq(
  format($$select id, position::int, set_type::text, target_reps_min::int, target_weight_kg, to_failure, rest_seconds::int
    from public.workout_sets where workout_exercise_id = %L order by position$$, :'e1'),
  format($$values (%L::uuid, 0, 'normal', 8, 60.000::numeric(7,3), false, 90), (%L::uuid, 1, 'normal', 8, 60.000, false, 90),
    (%L::uuid, 2, 'normal', 8, 60.000, false, 90), (%L::uuid, 3, 'drop', null::int, null::numeric(7,3), true, 0)$$,
    :'s1', :'s2', :'s3', :'s4'),
  'the straight block''s sets are stored in order with their targets');
select is((select count(*)::int from public.workout_sets
  where workout_id = :'w1' and workspace_id = :'ws_a' and client_id is null), 10,
  'every set inherits the workout''s workspace and null client');
reset role;
select lives_ok('set constraints all immediate', 'the saved positions satisfy the unique constraints');
set constraints all deferred;

-- Age the rows so "untouched" is observable (now() is fixed inside the test transaction).
-- Triggers are skipped so touch_updated_at keeps the old stamp.
set session_replication_role = replica;
update public.workout_blocks set updated_at = '2000-01-01' where workout_id = :'w1';
update public.workout_exercises set updated_at = '2000-01-01' where workout_id = :'w1';
update public.workout_sets set updated_at = '2000-01-01' where workout_id = :'w1';
set session_replication_role = origin;
select count(*)::int as total_sets_before from public.workout_sets \gset

-- ---------------------------------------------------------------------------------------------
-- Re-save: blocks swapped, one set removed, one target changed
select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', :'doc2'::jsonb), :'w1'::uuid, 're-save returns the same id');
select is((select name from public.workouts where id = :'w1'), 'Upper A v2', 'the workout is renamed');
select results_eq(
  format($$select id, position::int from public.workout_blocks where workout_id = %L order by position$$, :'w1'),
  format($$values (%L::uuid, 0), (%L::uuid, 1)$$, :'b2', :'b1'),
  'block ids are kept and their positions follow the new order');
select results_eq(
  format($$select id, position::int from public.workout_sets where workout_exercise_id = %L order by position$$, :'e1'),
  format($$values (%L::uuid, 0), (%L::uuid, 1), (%L::uuid, 2)$$, :'s1', :'s2', :'s4'),
  'the removed set is gone and the drop moves up');
select is((select count(*)::int from public.workout_sets where id = :'s3'), 0, 'set 3 is deleted');
select is((select target_weight_kg from public.workout_sets where id = :'s5'), 22.500::numeric(7,3), 'set 5''s target changed');
select is((select count(*)::int from public.workout_sets where workout_id = :'w1'), 9, '9 sets remain');
select is((select count(*)::int from public.workout_exercises where workout_id = :'w1'), 3, '3 exercises remain');
select is((select count(*)::int from public.workout_blocks where workout_id = :'w1'), 2, '2 blocks remain');
select is(
  (select array_agg(id order by id) from public.workout_sets
    where workout_id = :'w1' and updated_at > '2000-01-02'),
  array[:'s4', :'s5']::uuid[],
  'only the moved drop and the changed set were rewritten; the other sets are untouched');
select is(
  (select count(*)::int from public.workout_exercises where workout_id = :'w1' and updated_at > '2000-01-02'), 0,
  'unchanged exercises are untouched');
reset role;
select is((select count(*)::int from public.workout_sets), :total_sets_before - 1, 'no leftover set rows anywhere');
select lives_ok('set constraints all immediate', 'the rewritten positions satisfy the unique constraints');
set constraints all deferred;

-- ---------------------------------------------------------------------------------------------
-- Re-save an instance: client and date stay, the library workout is not touched
set session_replication_role = replica;
update public.workouts set updated_at = '2000-01-01' where id = :'lib_a';
update public.workout_sets set updated_at = '2000-01-01' where workout_id = :'lib_a';
set session_replication_role = origin;
select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', :'doc_inst'::jsonb), :'inst_a1'::uuid, 'coach A saves A1''s instance');
select results_eq(
  format($$select client_id, scheduled_on, source_workout_id, name from public.workouts where id = %L$$, :'inst_a1'),
  format($$values (%L::uuid, '2026-11-10'::date, %L::uuid, 'A1 Day (edited)')$$, :'a1', :'lib_a'),
  'the instance keeps its client, date and source; only the name changes');
select results_eq(
  format($$select id, position::int, target_weight_kg, client_id from public.workout_sets where workout_id = %L order by position$$,
    :'inst_a1'),
  format($$values (%L::uuid, 0, 70.000::numeric(7,3), %L::uuid), (%L::uuid, 1, null::numeric(7,3), %L::uuid),
    (%L::uuid, 2, 70.000::numeric(7,3), %L::uuid)$$, :'inst_set0', :'a1', :'inst_set1', :'a1', :'snew', :'a1'),
  'the instance''s sets are updated and the new set belongs to A1');
select results_eq(
  format($$select name, updated_at from public.workouts where id = %L$$, :'lib_a'),
  $$values ('SW A Library', '2000-01-01'::timestamptz)$$,
  'the library workout is untouched');
select results_eq(
  format($$select position::int, target_weight_kg, updated_at from public.workout_sets where workout_id = %L order by position$$,
    :'lib_a'),
  $$values (0, 60.000::numeric(7,3), '2000-01-01'::timestamptz), (1, null::numeric(7,3), '2000-01-01'::timestamptz)$$,
  'the library workout''s sets are untouched');

-- ---------------------------------------------------------------------------------------------
-- Coach A cannot reach workspace B
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_b', :'doc1'),
  '42501', null, 'coach A cannot save into workspace B');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_b_id'),
  '42501', null, 'coach A cannot overwrite B''s workout by reusing its id');
reset role;
select results_eq(
  format($$select workspace_id, name from public.workouts where id = %L$$, :'lib_b'),
  format($$values (%L::uuid, 'SW B Library')$$, :'ws_b'),
  'B''s workout is unchanged');
select is((select count(*)::int from public.workout_blocks where workout_id = :'lib_b'), 1, 'B''s blocks are unchanged');
select is(
  (select count(*)::int from public.workout_blocks where id = :'gb')
    + (select count(*)::int from public.workout_exercises where id = :'ge')
    + (select count(*)::int from public.workout_sets where id = :'gs'),
  0, 'the block, exercise and set the refused save into B''s workout carried were not created');

-- ---------------------------------------------------------------------------------------------
-- Clients and anon cannot save
select tests.act_as(:'a1');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_inst_client'),
  '42501', null, 'client A1 cannot save, not even their own instance');
reset role;
select is((select name from public.workouts where id = :'inst_a1'), 'A1 Day (edited)', 'A1''s refused save changed nothing');
select tests.act_as_anon();
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc1'),
  '42501', null, 'anon cannot save');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Document guards
select tests.act_as(:'coach_a');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_lead_drop'),
  '23514', 'A drop set must follow a normal or warm-up set.', 'a leading drop is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_short_superset'),
  '23514', 'A superset needs at least two exercises.', 'a one-exercise superset is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_no_blocks'),
  '23514', 'Add at least one exercise.', 'a doc with no blocks is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_wide_straight'),
  '23514', 'A straight-sets block has exactly one exercise.', 'a straight block with two exercises is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_no_sets'),
  '23514', 'Every exercise needs at least one set.', 'an exercise with no sets is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_stolen_set'),
  '23514', format('Row %s belongs to another workout.', :'lib_a_set0'),
  'a set id from another of A''s workouts is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_stolen_block'),
  '23514', format('Row %s belongs to another workout.', :'lib_a_block'),
  'a block id from another of A''s workouts is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_dup_id'),
  '23514', format('Row %s appears twice in the workout.', :'gs'),
  'a doc that repeats a row id is refused');
reset role;
select results_eq(
  format($$select workout_exercise_id, position::int, target_weight_kg from public.workout_sets where id = %L$$, :'lib_a_set0'),
  format($$select id, 0, 60.000::numeric(7,3) from public.workout_exercises where workout_id = %L$$, :'lib_a'),
  'the library set whose id was reused is unchanged');
select is((select count(*)::int from public.workouts where id = :'gw'), 0, 'no refused doc left a workout behind');

-- ---------------------------------------------------------------------------------------------
-- Sections and pick-one groups
select ok(has_column_privilege('authenticated', 'public.workout_blocks', 'section_id', 'insert')
  and has_column_privilege('authenticated', 'public.workout_blocks', 'section_name', 'insert')
  and has_column_privilege('authenticated', 'public.workout_blocks', 'section_id', 'update')
  and has_column_privilege('authenticated', 'public.workout_blocks', 'section_name', 'update'),
  'authenticated may insert and update the section columns (save_workout is security invoker)');
select ok(not has_column_privilege('anon', 'public.workout_blocks', 'section_id', 'insert')
  and not has_column_privilege('anon', 'public.workout_blocks', 'section_name', 'update'),
  'anon has no section column privileges');

\set uw '5a000000-0000-4000-8000-000000000003'
\set su '5a000000-0000-4000-8000-0000000005c1'
\set sc '5a000000-0000-4000-8000-0000000005c2'
\set ub0 '5a000000-0000-4000-8000-0000000003b0'
\set ub1 '5a000000-0000-4000-8000-0000000003b1'
\set ub2 '5a000000-0000-4000-8000-0000000003b2'
\set ub3 '5a000000-0000-4000-8000-0000000003b3'
\set ue0 '5a000000-0000-4000-8000-0000000003e0'
\set ue1 '5a000000-0000-4000-8000-0000000003e1'
\set ue2 '5a000000-0000-4000-8000-0000000003e2'
\set ue3 '5a000000-0000-4000-8000-0000000003e3'
\set ue4 '5a000000-0000-4000-8000-0000000003e4'
\set ue5 '5a000000-0000-4000-8000-0000000003e5'
\set us0 '5a000000-0000-4000-8000-000000000380'
\set us1 '5a000000-0000-4000-8000-000000000381'
\set us2 '5a000000-0000-4000-8000-000000000382'
\set us3 '5a000000-0000-4000-8000-000000000383'
\set us4 '5a000000-0000-4000-8000-000000000384'
\set us5 '5a000000-0000-4000-8000-000000000385'
\set us6 '5a000000-0000-4000-8000-000000000386'
\set us7 '5a000000-0000-4000-8000-000000000387'

-- Upper / Core: a warm-up block with no section, then Upper (a straight block and a pick-one group of two) and
-- Core (an uneven superset: 2 sets and 1 set). The Upper name carries spaces the server trims.
create function tests.sw_sec_block(id uuid, section_id uuid, kind text, exercises jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'sectionId', section_id, 'kind', kind, 'exercises', exercises);
$$;
select jsonb_build_object('id', :'uw', 'name', 'Upper / Core', 'notes', null,
  'sections', jsonb_build_array(jsonb_build_object('id', :'su', 'name', '  Upper  '),
    jsonb_build_object('id', :'sc', 'name', 'Core')),
  'blocks', jsonb_build_array(
    tests.sw_sec_block(:'ub0', null, 'straight', jsonb_build_array(
      tests.sw_ex(:'ue0', :'ex_bi', jsonb_build_array(tests.sw_set(:'us0', 'warmup', 10))))),
    tests.sw_sec_block(:'ub1', :'su', 'straight', jsonb_build_array(
      tests.sw_ex(:'ue1', :'ex_bi', jsonb_build_array(tests.sw_set(:'us1', 'normal', 8, 60))))),
    tests.sw_sec_block(:'ub2', :'su', 'choice', jsonb_build_array(
      tests.sw_ex(:'ue2', :'ex_bi', jsonb_build_array(tests.sw_set(:'us2', 'normal', 10, 20))),
      tests.sw_ex(:'ue3', :'ex_a', jsonb_build_array(tests.sw_set(:'us3', 'normal', 10, 20),
        tests.sw_set(:'us4', 'normal', 10, 20))))),
    tests.sw_sec_block(:'ub3', :'sc', 'superset', jsonb_build_array(
      tests.sw_ex(:'ue4', :'ex_bi', jsonb_build_array(tests.sw_set(:'us5', 'normal', 15),
        tests.sw_set(:'us6', 'normal', 15))),
      tests.sw_ex(:'ue5', :'ex_a', jsonb_build_array(tests.sw_set(:'us7', 'normal', 12))))))) as doc_sec \gset

select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', :'doc_sec'::jsonb), :'uw'::uuid, 'the Upper / Core doc saves');
select results_eq(
  format($$select id, position::int, kind::text, section_id, section_name from public.workout_blocks
    where workout_id = %L order by position$$, :'uw'),
  format($$values (%L::uuid, 0, 'straight', null::uuid, null::text), (%L::uuid, 1, 'straight', %L::uuid, 'Upper'),
    (%L::uuid, 2, 'choice', %L::uuid, 'Upper'), (%L::uuid, 3, 'superset', %L::uuid, 'Core')$$,
    :'ub0', :'ub1', :'su', :'ub2', :'su', :'ub3', :'sc'),
  'each block stores its kind and its section''s id and trimmed name');
select is((select count(*)::int from public.workout_exercises where block_id = :'ub2'), 2,
  'the pick-one group keeps both options');
select is((select count(*)::int from public.workout_sets where workout_id = :'uw'), 8,
  'every option and the uneven superset keep their sets');
reset role;

set session_replication_role = replica;
update public.workout_blocks set updated_at = '2000-01-01' where workout_id = :'uw';
set session_replication_role = origin;

-- Re-save with Core renamed: only Core's block is rewritten.
select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', jsonb_set(:'doc_sec'::jsonb, '{sections,1,name}', '"Abs"')), :'uw'::uuid,
  'the doc re-saves with a renamed section');
select results_eq(
  format($$select id, section_name, updated_at > '2000-01-02' from public.workout_blocks
    where workout_id = %L and section_id is not null order by position$$, :'uw'),
  format($$values (%L::uuid, 'Upper'::text, false), (%L::uuid, 'Upper', false), (%L::uuid, 'Abs', true)$$,
    :'ub1', :'ub2', :'ub3'),
  'the renamed section''s block is rewritten; the unchanged ones are untouched');
-- Taking the superset out of its section clears both columns.
select is(public.save_workout(:'ws_a', jsonb_set(
    jsonb_set(:'doc_sec'::jsonb, '{blocks,3,sectionId}', 'null'), '{sections}',
    jsonb_build_array(jsonb_build_object('id', :'su', 'name', 'Upper')))), :'uw'::uuid,
  'the doc re-saves without the Core section');
select results_eq(
  format($$select section_id, section_name from public.workout_blocks where id = %L$$, :'ub3'),
  $$values (null::uuid, null::text)$$,
  'a block moved out of its section loses both section columns');
reset role;

-- Guards
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'choice', jsonb_build_array(
  tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8))))))) as doc_one_option \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_block(:'gb', 'choice', (
  select jsonb_agg(tests.sw_ex(gen_random_uuid(), :'ex_bi', jsonb_build_array(tests.sw_set(gen_random_uuid(), 'normal', 8))))
  from generate_series(1, 6))))) as doc_six_options \gset
select jsonb_set(tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_sec_block(:'gb', :'sc', 'straight',
  jsonb_build_array(tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8))))))),
  '{sections}', jsonb_build_array(jsonb_build_object('id', :'su', 'name', 'Upper'))) as doc_unknown_section \gset
select tests.sw_doc(:'gw', 'Guard', jsonb_build_array(tests.sw_sec_block(:'gb', :'su', 'straight',
  jsonb_build_array(tests.sw_ex(:'ge', :'ex_bi', jsonb_build_array(tests.sw_set(:'gs', 'normal', 8)))))))
  as doc_no_sections_key \gset

select tests.act_as(:'coach_a');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_one_option'),
  '23514', 'A pick-one group needs 2 to 5 exercises.', 'a one-option pick-one group is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_six_options'),
  '23514', 'A pick-one group needs 2 to 5 exercises.', 'a six-option pick-one group is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_unknown_section'),
  '23514', 'Unknown section.', 'a block naming a section the doc does not have is refused');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_no_sections_key'),
  '23514', 'Unknown section.', 'a section id with no sections list is refused');
reset role;
select is((select count(*)::int from public.workouts where id = :'gw'), 0, 'no refused section doc left a workout behind');

-- Other people cannot touch or write a section into workspace A's workouts
select tests.act_as(:'a1');
select is_empty(format($$update public.workout_blocks set section_name = 'X' where id = %L returning id$$, :'ub1'),
  'a client cannot rename a section on a workout block (0 rows)');
reset role;
select tests.act_as(:'coach_b');
select is_empty(format($$update public.workout_blocks set section_name = 'X' where id = %L returning id$$, :'ub1'),
  'a coach from another workspace cannot rename a section on a workout block (0 rows)');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', :'doc_sec'),
  '42501', 'Only a coach of this workspace can save workouts.', 'a coach from another workspace cannot save a sectioned workout into workspace A');
reset role;

-- Table checks (as postgres, so only the constraints can refuse)
select throws_ok(format($$update public.workout_blocks set section_name = 'Lonely' where id = %L$$, :'ub0'),
  '23514', null, 'a section name without a section id is refused');
select throws_ok(format($$update public.workout_blocks set section_id = gen_random_uuid() where id = %L$$, :'ub0'),
  '23514', null, 'a section id without a name is refused');
select throws_ok(format($$update public.workout_blocks set section_name = '   ' where id = %L$$, :'ub1'),
  '23514', null, 'a blank section name is refused');
select throws_ok(format($$update public.workout_blocks set section_name = repeat('x', 41) where id = %L$$, :'ub1'),
  '23514', null, 'a section name over 40 characters is refused');

select * from finish();
rollback;
