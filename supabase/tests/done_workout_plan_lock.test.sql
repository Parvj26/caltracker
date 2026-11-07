begin;
select plan(28);

-- A client's workout that has a completed log keeps its plan, so planned vs. actual on the log still matches what
-- the client was given: the database refuses changing its name, notes, day, blocks, exercises, sets or substitutes,
-- through save_workout or straight on the tables. A missed one, or one with only an in-progress or discarded log, can
-- change. Deleting a done workout still works (its children go with it, its log keeps its results).

-- Fixtures (as postgres)
select tests.create_user('dl-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('dl-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('dl-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('dl-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('DL Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('DL Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.create_exercise(null, 'DL Builtin') as ex \gset
select tests.create_exercise(null, 'DL Other') as ex2 \gset

select tests.create_workout(:'ws_a', 'DL Done', :'a1', '2026-11-02', :'ex') as done \gset
select tests.create_workout(:'ws_a', 'DL Missed', :'a1', '2026-11-03', :'ex') as missed \gset
select tests.create_workout(:'ws_a', 'DL In progress', :'a1', '2026-11-04', :'ex') as inprog \gset
select tests.create_workout(:'ws_a', 'DL Discarded', :'a2', '2026-11-04', :'ex') as discarded \gset
select tests.create_log(:'ws_a', :'a1', :'done', 'completed') as done_log \gset
select tests.create_log(:'ws_a', :'a1', :'inprog', 'in_progress') as inprog_log \gset
select tests.create_log(:'ws_a', :'a2', :'discarded', 'discarded') as discarded_log \gset

select id as done_block from public.workout_blocks where workout_id = :'done' \gset
select id as done_we from public.workout_exercises where workout_id = :'done' \gset
select id as done_set from public.workout_sets where workout_id = :'done' and position = 0 \gset
select id as inprog_set from public.workout_sets where workout_id = :'inprog' and position = 0 \gset
select id as discarded_set from public.workout_sets where workout_id = :'discarded' and position = 0 \gset

-- A one-exercise doc with fresh row ids (save_workout replaces the old rows with these).
create function tests.dl_doc(id uuid, name text, ex uuid) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'name', name, 'notes', null, 'blocks', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'kind', 'straight', 'exercises', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'exerciseId', ex, 'exerciseName', 'ignored',
        'trackingType', 'weight_reps', 'note', null, 'sets', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'setType', 'normal', 'targetRepsMin', 5, 'targetRepsMax', 5,
            'targetWeightKg', 100, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', false,
            'restSeconds', 120, 'note', null)))))));
$$;
grant execute on function tests.dl_doc(uuid, text, uuid) to authenticated;

\set msg 'This workout is already done, so its plan can''t change. Edit the logged results instead.'

-- ---------- A done workout: refused ----------
select tests.act_as(:'coach_a');

select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', tests.dl_doc(:'done', 'DL Done', :'ex')),
  '23514', :'msg', 'save_workout refuses a done workout, even under its own name');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', tests.dl_doc(:'done', 'DL Done v2', :'ex')),
  '23514', :'msg', 'save_workout refuses renaming a done workout');
select throws_ok(format($$update public.workouts set name = 'Renamed' where id = %L$$, :'done'),
  '23514', :'msg', 'a direct rename of a done workout is refused');
select throws_ok(format($$update public.workouts set notes = 'New notes' where id = %L$$, :'done'),
  '23514', :'msg', 'a direct notes change of a done workout is refused');
select throws_ok(format($$update public.workouts set scheduled_on = '2026-11-20' where id = %L$$, :'done'),
  '23514', :'msg', 'moving a done workout is refused');
select throws_ok(format($$update public.workout_blocks set kind = 'superset' where id = %L$$, :'done_block'),
  '23514', :'msg', 'changing a done workout''s block is refused');
select throws_ok(format($$update public.workout_exercises set exercise_id = %L where id = %L$$, :'ex2', :'done_we'),
  '23514', :'msg', 'swapping a done workout''s exercise is refused');
select throws_ok(format($$update public.workout_sets set target_reps_min = 12, target_reps_max = 12 where id = %L$$, :'done_set'),
  '23514', :'msg', 'changing a done workout''s set is refused');
select throws_ok(format($$insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max)
  values (%L, 5, 'normal', 8, 8)$$, :'done_we'),
  '23514', :'msg', 'adding a set to a done workout is refused');
select throws_ok(format($$delete from public.workout_sets where id = %L$$, :'done_set'),
  '23514', :'msg', 'removing a set from a done workout is refused');
select throws_ok(format($$insert into public.workout_exercises (block_id, position, exercise_id) values (%L, 1, %L)$$, :'done_block', :'ex2'),
  '23514', :'msg', 'adding an exercise to a done workout is refused');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 0, %L, %L::jsonb)$$, :'done_we', :'ex2',
  '[{"id":"6d000000-0000-4000-8000-000000000001","setType":"normal","targetRepsMin":8,"targetRepsMax":8,"targetWeightKg":null,"targetDurationS":null,"targetDistanceM":null,"toFailure":false,"restSeconds":60,"note":null}]'),
  '23514', :'msg', 'adding a substitute to a done workout is refused');
select is((select target_reps_min from public.workout_sets where id = :'done_set'), 8::smallint, 'the done workout''s plan is unchanged');

-- A change that leaves the plan as it was (another column) still goes through.
select lives_ok(format($$update public.workouts set name = name, notes = notes, scheduled_on = scheduled_on where id = %L$$, :'done'),
  'an update that changes nothing in the plan is allowed');

-- ---------- Not done: allowed ----------
select lives_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', tests.dl_doc(:'missed', 'DL Missed v2', :'ex')),
  'save_workout saves a missed (past, never done) workout');
select is((select name from public.workouts where id = :'missed'), 'DL Missed v2', 'the missed workout was saved');
select lives_ok(format($$update public.workouts set scheduled_on = '2026-11-21' where id = %L$$, :'missed'),
  'a missed workout can be moved');
select lives_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', tests.dl_doc(:'inprog', 'DL In progress v2', :'ex')),
  'save_workout saves a workout with only an in-progress log');
select lives_ok(format($$update public.workout_sets set target_reps_min = 6, target_reps_max = 6 where id = %L$$, :'discarded_set'),
  'a workout with only a discarded log can change straight on the table');
select is((select target_reps_min from public.workout_sets where id = :'discarded_set'), 6::smallint, 'the discarded one''s set changed');

-- ---------- Other workspaces still can't touch it ----------
select tests.act_as(:'coach_b');
select throws_ok(format($$select public.save_workout(%L, %L::jsonb)$$, :'ws_a', tests.dl_doc(:'missed', 'Hijack', :'ex')),
  '42501', null, 'a coach of another workspace can''t save into this one');
select is_empty(format($$update public.workout_sets set target_reps_min = 1 where id = %L returning id$$, :'discarded_set'),
  'a coach of another workspace changes no set here');
select tests.act_as(:'a2');
select is_empty(format($$update public.workout_sets set target_reps_min = 1 where id = %L returning id$$, :'done_set'),
  'another client changes no set of this client');

-- ---------- Repointing a row into a done workout is refused, even past RLS ----------
reset role;
select throws_ok(format($$update public.workout_sets set workout_id = %L where id = %L$$, :'done', :'discarded_set'),
  '23514', :'msg', 'a set of another workout can''t be moved into a done workout, even as postgres');

-- ---------- Deleting a done workout still works ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$delete from public.workouts where id = %L$$, :'done'), 'a done workout can be deleted');
reset role;
select is((select count(*)::int from public.workout_sets where workout_id = :'done'), 0, 'its sets went with it');
select is((select count(*)::int from public.workout_blocks where workout_id = :'done'), 0, 'its blocks went with it');
select is((select workout_id from public.workout_logs where id = :'done_log'), null, 'its log stays, no longer linked');

select * from finish();
rollback;
