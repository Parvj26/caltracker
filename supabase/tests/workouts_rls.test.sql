begin;
select plan(90);

-- Fixtures (as postgres)
select tests.create_user('wo-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('wo-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('wo-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('wo-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('wo-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('WO Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('WO Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_exercise(null, 'WO Builtin') as ex_bi \gset
select tests.create_exercise(:'ws_a', 'WO A Custom') as ex_a \gset
select tests.create_exercise(:'ws_b', 'WO B Custom', 'reps') as ex_b \gset

select tests.create_workout(:'ws_a', 'A Library', ex => :'ex_a') as lib_a \gset
select tests.create_workout(:'ws_a', 'A1 Day', :'a1', '2026-11-10') as inst_a1 \gset
select tests.create_workout(:'ws_a', 'A2 Day', :'a2', '2026-11-10') as inst_a2 \gset
select tests.create_workout(:'ws_b', 'B Library', ex => :'ex_b') as lib_b \gset

select id as lib_a_block from public.workout_blocks where workout_id = :'lib_a' \gset
select id as lib_a_we from public.workout_exercises where workout_id = :'lib_a' \gset
select id as inst_a1_we from public.workout_exercises where workout_id = :'inst_a1' \gset
select id as lib_b_set from public.workout_sets where workout_id = :'lib_b' and position = 0 \gset

-- ---------------------------------------------------------------------------------------------
-- Privileges
select ok(not has_table_privilege('anon', 'public.workouts', 'select,insert,update,delete'), 'anon has no privileges on workouts');
select ok(not has_table_privilege('anon', 'public.workout_blocks', 'select,insert,update,delete'), 'anon has no privileges on workout_blocks');
select ok(not has_table_privilege('anon', 'public.workout_exercises', 'select,insert,update,delete'), 'anon has no privileges on workout_exercises');
select ok(not has_table_privilege('anon', 'public.workout_sets', 'select,insert,update,delete'), 'anon has no privileges on workout_sets');
select ok(not has_any_column_privilege('anon', 'public.workouts', 'select,insert,update')
  and not has_any_column_privilege('anon', 'public.workout_sets', 'select,insert,update'),
  'anon has no column privileges either');

select ok(not has_column_privilege('authenticated', 'public.workouts', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'source_workout_id', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'assignment_id', 'update')
  and not has_column_privilege('authenticated', 'public.workouts', 'created_by', 'update'),
  'authenticated cannot update workouts.client_id/workspace_id/source_workout_id/assignment_id/created_by');
select ok(not has_column_privilege('authenticated', 'public.workouts', 'source_workout_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workouts', 'assignment_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workouts', 'created_by', 'insert'),
  'authenticated cannot insert workouts.source_workout_id/assignment_id/created_by');
select ok(has_column_privilege('authenticated', 'public.workouts', 'name', 'update')
  and has_column_privilege('authenticated', 'public.workouts', 'notes', 'update')
  and has_column_privilege('authenticated', 'public.workouts', 'scheduled_on', 'update'),
  'authenticated can update workouts.name/notes/scheduled_on');
select ok(not has_column_privilege('authenticated', 'public.workout_blocks', 'workout_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_blocks', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_blocks', 'client_id', 'update'),
  'authenticated cannot update workout_blocks parent/owner columns');
select ok(not has_column_privilege('authenticated', 'public.workout_exercises', 'block_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_exercises', 'workout_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_exercises', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_exercises', 'client_id', 'update'),
  'authenticated cannot update workout_exercises parent/owner columns');
select ok(not has_column_privilege('authenticated', 'public.workout_sets', 'workout_exercise_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_sets', 'workout_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_sets', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.workout_sets', 'client_id', 'update'),
  'authenticated cannot update workout_sets parent/owner columns');
select ok(not has_column_privilege('authenticated', 'public.workout_blocks', 'workspace_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_blocks', 'client_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_exercises', 'workout_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_sets', 'workout_id', 'insert')
  and not has_column_privilege('authenticated', 'public.workout_sets', 'workspace_id', 'insert'),
  'authenticated cannot insert denormalized owner columns on child tables');
select ok(not has_function_privilege('anon', 'public.is_client_in(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.exercise_usable_in(uuid, uuid)', 'execute'),
  'anon cannot call the workout helpers');
select ok(has_function_privilege('authenticated', 'public.is_client_in(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.exercise_usable_in(uuid, uuid)', 'execute'),
  'authenticated can call the workout helpers');
select ok(not has_function_privilege('authenticated', 'public.inherit_workout_owner()', 'execute')
  and not has_function_privilege('authenticated', 'public.touch_updated_at()', 'execute'),
  'trigger functions are not callable by authenticated');
select has_trigger('public', 'workouts', 'workouts_touch_updated_at', 'workouts has the updated_at trigger');
select has_trigger('public', 'workout_blocks', 'workout_blocks_touch_updated_at', 'workout_blocks has the updated_at trigger');
select has_trigger('public', 'workout_exercises', 'workout_exercises_touch_updated_at', 'workout_exercises has the updated_at trigger');
select has_trigger('public', 'workout_sets', 'workout_sets_touch_updated_at', 'workout_sets has the updated_at trigger');

-- ---------------------------------------------------------------------------------------------
-- anon reads nothing
select tests.act_as_anon();
select throws_ok($$select * from public.workouts$$, '42501', null, 'anon cannot select workouts');
select throws_ok($$select * from public.workout_blocks$$, '42501', null, 'anon cannot select workout_blocks');
select throws_ok($$select * from public.workout_exercises$$, '42501', null, 'anon cannot select workout_exercises');
select throws_ok($$select * from public.workout_sets$$, '42501', null, 'anon cannot select workout_sets');
reset role;

-- ---------------------------------------------------------------------------------------------
-- Client A1
select tests.act_as(:'a1');
select is((select count(*)::int from public.workouts where id = :'inst_a1'), 1, 'A1 reads own instance');
select is((select count(*)::int from public.workout_blocks where workout_id = :'inst_a1'), 1, 'A1 reads own blocks');
select is((select count(*)::int from public.workout_exercises where workout_id = :'inst_a1'), 1, 'A1 reads own exercises');
select is((select count(*)::int from public.workout_sets where workout_id = :'inst_a1'), 2, 'A1 reads own sets');
select is(
  (select count(*)::int from public.workouts where id = :'inst_a2')
  + (select count(*)::int from public.workout_blocks where workout_id = :'inst_a2')
  + (select count(*)::int from public.workout_exercises where workout_id = :'inst_a2')
  + (select count(*)::int from public.workout_sets where workout_id = :'inst_a2'),
  0, 'A1 reads nothing of A2''s instance');
select is(
  (select count(*)::int from public.workouts where id = :'lib_a')
  + (select count(*)::int from public.workout_blocks where workout_id = :'lib_a')
  + (select count(*)::int from public.workout_exercises where workout_id = :'lib_a')
  + (select count(*)::int from public.workout_sets where workout_id = :'lib_a'),
  0, 'A1 reads nothing of A''s library workout (coach-only)');
select is(
  (select count(*)::int from public.workouts where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_blocks where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_exercises where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_sets where workspace_id = :'ws_b'),
  0, 'A1 reads nothing of workspace B');
select is((select count(*)::int from public.workouts), 1, 'A1 sees exactly one workout');

select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (%L, %L, '2026-11-11', 'Mine')$$,
    :'ws_a', :'a1'),
  '42501', null, 'A1 cannot create a workout');
select throws_ok(
  format($$insert into public.workout_blocks (workout_id, position, kind) values (%L, 5, 'straight')$$, :'inst_a1'),
  '42501', null, 'A1 cannot add a block to own instance');
select throws_ok(
  format($$insert into public.workout_exercises (block_id, position, exercise_id)
    select id, 5, %L from public.workout_blocks where workout_id = %L$$, :'ex_bi', :'inst_a1'),
  '42501', null, 'A1 cannot add an exercise to own instance');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type) values (%L, 5, 'normal')$$, :'inst_a1_we'),
  '42501', null, 'A1 cannot add a set to own instance');
update public.workouts set name = 'Hacked' where id = :'inst_a1';
update public.workout_blocks set kind = 'superset' where workout_id = :'inst_a1';
update public.workout_exercises set note = 'Hacked' where workout_id = :'inst_a1';
update public.workout_sets set target_weight_kg = 999 where workout_id = :'inst_a1';
delete from public.workout_sets where workout_id = :'inst_a1';
delete from public.workout_exercises where workout_id = :'inst_a1';
delete from public.workout_blocks where workout_id = :'inst_a1';
delete from public.workouts where id = :'inst_a1';
reset role;
select is((select name from public.workouts where id = :'inst_a1'), 'A1 Day', 'A1 could not rename or delete own workout');
select is((select kind::text from public.workout_blocks where workout_id = :'inst_a1'), 'straight', 'A1 could not change own block');
select is((select note from public.workout_exercises where workout_id = :'inst_a1'), null, 'A1 could not change own exercise');
select results_eq(
  format($$select target_weight_kg from public.workout_sets where workout_id = %L order by position$$, :'inst_a1'),
  $$values (60.000::numeric(7,3)), (null::numeric(7,3))$$,
  'A1 could neither change nor delete own sets');

-- ---------------------------------------------------------------------------------------------
-- Coach A reads
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.workouts where id in (:'lib_a', :'inst_a1', :'inst_a2')), 3,
  'coach A reads the library workout and both instances');
select is((select count(*)::int from public.workout_blocks where workout_id in (:'lib_a', :'inst_a1', :'inst_a2')), 3,
  'coach A reads their blocks');
select is((select count(*)::int from public.workout_exercises where workout_id in (:'lib_a', :'inst_a1', :'inst_a2')), 3,
  'coach A reads their exercises');
select is((select count(*)::int from public.workout_sets where workout_id in (:'lib_a', :'inst_a1', :'inst_a2')), 6,
  'coach A reads their sets');
select is(
  (select count(*)::int from public.workouts where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_blocks where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_exercises where workspace_id = :'ws_b')
  + (select count(*)::int from public.workout_sets where workspace_id = :'ws_b'),
  0, 'coach A reads nothing of workspace B');

-- Coach A builds a library workout
insert into public.workouts (workspace_id, name, notes) values (:'ws_a', 'Upper A', 'Go heavy') returning id as new_w \gset
insert into public.workout_blocks (workout_id, position, kind) values (:'new_w', 0, 'superset') returning id as new_b \gset
insert into public.workout_exercises (block_id, position, exercise_id, note) values (:'new_b', 0, :'ex_a', 'Slow') returning id as new_we \gset
insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max, target_weight_kg, rest_seconds)
values (:'new_we', 0, 'normal', 6, 10, 80.5, 120) returning id as new_s \gset
select results_eq(
  format($$select workspace_id, client_id, scheduled_on, created_by from public.workouts where id = %L$$, :'new_w'),
  format($$values (%L::uuid, null::uuid, null::date, %L::uuid)$$, :'ws_a', :'coach_a'),
  'coach A creates a library workout (created_by is the caller)');
select results_eq(
  format($$select workout_id, workspace_id, client_id from public.workout_sets where id = %L$$, :'new_s'),
  format($$values (%L::uuid, %L::uuid, null::uuid)$$, :'new_w', :'ws_a'),
  'a new set inherits workout_id/workspace_id/client_id from its parents');
select is((select count(*)::int from public.workout_exercises where workout_id = :'new_w' and block_id = :'new_b'), 1,
  'coach A adds an exercise to the block');
reset role;

-- updated_at advances (a set stamped in the past, inserted as postgres; touch runs only on update)
insert into public.workout_sets (workout_exercise_id, position, set_type, created_at, updated_at)
values (:'new_we', 1, 'normal', '2000-01-01', '2000-01-01') returning id as old_s \gset
select tests.act_as(:'coach_a');
update public.workout_sets set target_weight_kg = 82.5 where id = :'old_s';
select is((select target_weight_kg from public.workout_sets where id = :'old_s'), 82.500::numeric(7,3),
  'coach A updates a set''s target_weight_kg');
select ok((select updated_at > '2000-01-02' from public.workout_sets where id = :'old_s'), 'updated_at advances on update');
update public.workouts set name = 'Upper A v2', notes = null where id = :'new_w';
select is((select name from public.workouts where id = :'new_w'), 'Upper A v2', 'coach A renames the workout');
update public.workout_sets set position = 0 where id = :'old_s';
update public.workout_sets set position = 1 where id = :'new_s';
select is((select position::int from public.workout_sets where id = :'old_s'), 0,
  'positions can be swapped (unique checks are deferred)');

-- Coach A deletes the workout; children cascade
delete from public.workouts where id = :'new_w';
reset role;
select is(
  (select count(*)::int from public.workouts where id = :'new_w')
  + (select count(*)::int from public.workout_blocks where workout_id = :'new_w')
  + (select count(*)::int from public.workout_exercises where workout_id = :'new_w')
  + (select count(*)::int from public.workout_sets where workout_id = :'new_w'),
  0, 'deleting a workout deletes its blocks, exercises and sets');

-- ---------------------------------------------------------------------------------------------
-- Coach A cannot reach workspace B or its people
select tests.act_as(:'coach_a');
select throws_ok(
  format($$insert into public.workouts (workspace_id, name) values (%L, 'Into B')$$, :'ws_b'),
  '42501', null, 'coach A cannot create a workout in workspace B');
select throws_ok(
  format($$insert into public.workout_blocks (workout_id, position, kind) values (%L, 5, 'straight')$$, :'lib_b'),
  '42501', null, 'coach A cannot add a block to B''s workout');
select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (%L, %L, '2026-11-10', 'For B1')$$,
    :'ws_a', :'b1'),
  '42501', null, 'coach A cannot create a workout for client B1');
select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (%L, %L, '2026-11-10', 'For coach B')$$,
    :'ws_a', :'coach_b'),
  '42501', null, 'coach A cannot create a workout for coach B');
select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (%L, %L, '2026-11-10', 'For me')$$,
    :'ws_a', :'coach_a'),
  '42501', null, 'a coach is not a client: no workout instance for coach A');
select throws_ok(
  format($$insert into public.workout_exercises (block_id, position, exercise_id) values (%L, 5, %L)$$, :'lib_a_block', :'ex_b'),
  '42501', null, 'coach A cannot add B''s custom exercise to A''s workout');
select throws_ok(
  format($$update public.workout_exercises set exercise_id = %L where id = %L$$, :'ex_b', :'lib_a_we'),
  '42501', null, 'coach A cannot switch an exercise to B''s custom exercise');
select lives_ok(
  format($$insert into public.workout_exercises (block_id, position, exercise_id) values (%L, 5, %L)$$, :'lib_a_block', :'ex_bi'),
  'coach A can add a built-in exercise');
update public.workout_sets set target_weight_kg = 999 where id = :'lib_b_set';
delete from public.workout_sets where id = :'lib_b_set';
delete from public.workouts where id = :'lib_b';
select ok(not public.is_client_in(:'ws_b', :'b1'), 'coach A cannot probe B''s client list through is_client_in');
select ok(not public.exercise_usable_in(:'ex_b', :'ws_b'), 'coach A cannot probe B''s exercises through exercise_usable_in');

-- Forgery: owner columns cannot be named
select throws_ok(
  format($$insert into public.workout_blocks (workout_id, workspace_id, position, kind) values (%L, %L, 6, 'straight')$$,
    :'lib_a', :'ws_b'),
  '42501', null, 'coach A cannot name workspace_id on a block');
select throws_ok(
  format($$insert into public.workout_blocks (workout_id, client_id, position, kind) values (%L, %L, 6, 'straight')$$,
    :'lib_a', :'a1'),
  '42501', null, 'coach A cannot name client_id on a block');
reset role;
select is((select target_weight_kg from public.workout_sets where id = :'lib_b_set'), 60.000::numeric(7,3),
  'coach A could neither change nor delete B''s set');
select is((select count(*)::int from public.workouts where id = :'lib_b'), 1, 'coach A could not delete B''s workout');

-- Forgery as postgres: the trigger overwrites owner columns from the parent
insert into public.workout_sets (workout_exercise_id, workout_id, workspace_id, client_id, position, set_type)
values (:'inst_a1_we', :'lib_b', :'ws_b', :'b1', 7, 'warmup') returning id as forged_s \gset
select results_eq(
  format($$select workout_id, workspace_id, client_id from public.workout_sets where id = %L$$, :'forged_s'),
  format($$values (%L::uuid, %L::uuid, %L::uuid)$$, :'inst_a1', :'ws_a', :'a1'),
  'a set with forged owner columns stores its parent''s values');
insert into public.workout_blocks (workout_id, workspace_id, client_id, position, kind)
values (:'inst_a1', :'ws_b', :'b1', 7, 'straight') returning id as forged_b \gset
select results_eq(
  format($$select workspace_id, client_id from public.workout_blocks where id = %L$$, :'forged_b'),
  format($$values (%L::uuid, %L::uuid)$$, :'ws_a', :'a1'),
  'a block with forged owner columns stores its workout''s values');
select throws_ok(
  $$insert into public.workout_blocks (workout_id, position, kind) values (gen_random_uuid(), 0, 'straight')$$,
  '23503', null, 'a block under a missing workout is a foreign key error');

-- ---------------------------------------------------------------------------------------------
-- Constraints (as postgres)
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, rest_seconds) values (%L, 20, 'drop', 30)$$, :'lib_a_we'),
  '23514', null, 'a drop set cannot have a rest timer');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, to_failure) values (%L, 20, 'warmup', true)$$, :'lib_a_we'),
  '23514', null, 'a warm-up set cannot be "to failure"');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max) values (%L, 20, 'normal', 10, 8)$$, :'lib_a_we'),
  '23514', null, 'reps min cannot exceed reps max');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, target_weight_kg) values (%L, 20, 'normal', -1)$$, :'lib_a_we'),
  '23514', null, 'weight cannot be negative');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, target_distance_m) values (%L, 20, 'normal', 0)$$, :'lib_a_we'),
  '23514', null, 'distance must be positive');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, rest_seconds) values (%L, 20, 'normal', 3601)$$, :'lib_a_we'),
  '23514', null, 'rest is at most an hour');
select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, name) values (%L, %L, 'No date')$$, :'ws_a', :'a1'),
  '23514', null, 'a client workout needs a date');
select throws_ok(
  format($$insert into public.workouts (workspace_id, scheduled_on, name) values (%L, '2026-11-10', 'Dated library')$$, :'ws_a'),
  '23514', null, 'a library workout has no date');
select throws_ok(
  format($$insert into public.workouts (workspace_id, name) values (%L, '')$$, :'ws_a'),
  '23514', null, 'a workout needs a name');
select throws_ok(
  format($$insert into public.workouts (workspace_id, name) values (%L, repeat('x', 101))$$, :'ws_a'),
  '23514', null, 'a workout name is at most 100 characters');

-- Removing something still in use (Review Focus 5)
select tests.act_as(:'coach_a');
select throws_ok(format($$delete from public.exercises where id = %L$$, :'ex_a'),
  '23503', null, 'a custom exercise used by a workout cannot be deleted');
reset role;

-- ---------------------------------------------------------------------------------------------
-- A removed client loses access; the coach keeps the history
select tests.act_as(:'coach_a');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws_a', :'a1'), 'coach A removes A1');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.workouts), 0, 'removed A1 reads none of their former workouts');
select is((select count(*)::int from public.workout_blocks), 0, 'removed A1 reads none of the blocks');
select is((select count(*)::int from public.workout_exercises), 0, 'removed A1 reads none of the exercises');
select is((select count(*)::int from public.workout_sets), 0, 'removed A1 reads none of the sets');
reset role;
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.workouts where id = :'inst_a1'), 1, 'coach A still reads A1''s past workout');
select is((select count(*)::int from public.workout_sets where workout_id = :'inst_a1'), 3, 'coach A still reads its sets');
select throws_ok(
  format($$insert into public.workouts (workspace_id, client_id, scheduled_on, name) values (%L, %L, '2026-11-12', 'After removal')$$,
    :'ws_a', :'a1'),
  '42501', null, 'coach A cannot create a workout for a removed client');
reset role;

-- Deleting a whole workspace still cascades through workouts that use its custom exercises
select lives_ok(format($$delete from public.workspaces where id = %L$$, :'ws_b'), 'workspace B can be deleted');
select is((select count(*)::int from public.workouts where id = :'lib_b'), 0, 'its workouts are gone');

select * from finish();
rollback;
