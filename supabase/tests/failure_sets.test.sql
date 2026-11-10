begin;
select plan(11);

-- F (failure) sets in the builder are normal sets with to_failure = true. Before this, only drops could be to
-- failure; now any set but a warm-up can be, in the plan (workout_sets) and in logs (log_sets).
select tests.create_user('fs-coach@t.local', 'FS Coach') as coach \gset
select tests.create_user('fs-client@t.local', 'FS Client') as client \gset
select tests.create_workspace('FS Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'client');
select tests.create_exercise(null, 'FS Builtin') as ex \gset
select tests.create_workout(:'ws', 'FS Library', ex => :'ex') as w \gset
select id as we from public.workout_exercises where workout_id = :'w' \gset
select tests.create_log(:'ws', :'client') as l \gset
select id as le from public.log_exercises where log_id = :'l' \gset

-- Plan sets
select lives_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, to_failure, rest_seconds)
    values (%L, 2, 'normal', true, 90)$$, :'we'),
  'a normal plan set can be to failure (F)');
select lives_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, to_failure)
    values (%L, 3, 'drop', true)$$, :'we'),
  'a drop plan set can still be to failure (older workouts)');
select throws_ok(
  format($$insert into public.workout_sets (workout_exercise_id, position, set_type, to_failure)
    values (%L, 4, 'warmup', true)$$, :'we'),
  '23514', null, 'a warm-up plan set cannot be to failure');

-- Log sets
select lives_ok(
  format($$insert into public.log_sets (log_exercise_id, position, set_type, to_failure, rest_seconds)
    values (%L, 2, 'normal', true, 90)$$, :'le'),
  'a normal log set can be to failure (F)');
select throws_ok(
  format($$insert into public.log_sets (log_exercise_id, position, set_type, to_failure)
    values (%L, 3, 'warmup', true)$$, :'le'),
  '23514', null, 'a warm-up log set cannot be to failure');
select throws_ok(
  format($$insert into public.log_sets (log_exercise_id, position, set_type, rest_seconds)
    values (%L, 4, 'drop', 60)$$, :'le'),
  '23514', null, 'a drop log set still has no rest');

-- The coach saves an F set through save_workout, and it reads back as normal + to_failure.
\set w2 '5f000000-0000-4000-8000-000000000001'
\set s1 '5f000000-0000-4000-8000-000000000501'
\set s2 '5f000000-0000-4000-8000-000000000502'
select tests.act_as(:'coach');
select is(public.save_workout(:'ws', jsonb_build_object('id', :'w2', 'name', 'FS Upper', 'notes', null, 'blocks',
  jsonb_build_array(jsonb_build_object('id', '5f000000-0000-4000-8000-0000000000b1', 'kind', 'straight', 'exercises',
    jsonb_build_array(jsonb_build_object('id', '5f000000-0000-4000-8000-0000000000e1', 'exerciseId', :'ex',
      'exerciseName', 'ignored', 'trackingType', 'weight_reps', 'note', null, 'sets', jsonb_build_array(
        jsonb_build_object('id', :'s1', 'setType', 'normal', 'targetRepsMin', 12, 'targetRepsMax', 12,
          'targetWeightKg', 40, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', false,
          'restSeconds', 90, 'note', null),
        jsonb_build_object('id', :'s2', 'setType', 'normal', 'targetRepsMin', null, 'targetRepsMax', null,
          'targetWeightKg', 40, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', true,
          'restSeconds', 90, 'note', null)))))))),
  :'w2'::uuid, 'save_workout accepts a normal set to failure');
reset role;
select results_eq(
  format($$select set_type::text, to_failure, rest_seconds::int from public.workout_sets where id = %L$$, :'s2'),
  $$values ('normal', true, 90)$$,
  'the F set is stored as a normal set to failure, keeping its rest');

-- The client logs an F set from the phone (save_workout_log), and a warm-up to failure is still refused.
\set lg '5f000000-0000-4000-8000-00000000a001'
\set lgset '5f000000-0000-4000-8000-00000000a501'
select jsonb_build_object('id', :'lg', 'workoutId', null, 'name', 'Logged', 'status', 'in_progress',
  'startedAt', now() - interval '1 hour', 'finishedAt', null, 'lastActivityAt', now() - interval '5 minutes',
  'autoFinished', false, 'revision', 1, 'notes', null, 'blocks', jsonb_build_array(jsonb_build_object(
    'id', '5f000000-0000-4000-8000-00000000a0b1', 'kind', 'straight', 'exercises', jsonb_build_array(
      jsonb_build_object('id', '5f000000-0000-4000-8000-00000000a0e1', 'exerciseId', :'ex', 'exerciseName', 'ignored',
        'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', null, 'swappedFromExerciseId', null, 'note', null,
        'sets', jsonb_build_array(jsonb_build_object('id', :'lgset', 'setType', 'normal',
          'target', jsonb_build_object('repsMin', null, 'repsMax', null, 'weightKg', 40, 'durationS', null,
            'distanceM', null, 'toFailure', true, 'restSeconds', 90),
          'actualReps', 14, 'actualWeightKg', 40, 'actualDurationS', null, 'actualDistanceM', null,
          'completedAt', to_jsonb(now() - interval '5 minutes')))))))) as fdoc \gset
select tests.act_as(:'client');
select lives_ok(format('select public.save_workout_log(%L::jsonb)', :'fdoc'), 'the client can log a normal set to failure');
reset role;
select results_eq(format($$select set_type::text, to_failure, actual_reps::int from public.log_sets where id = %L$$, :'lgset'),
  $$values ('normal', true, 14)$$, 'the logged F set keeps its failure target and the reps done');

-- Another workspace's coach still can't write into this workout (RLS unchanged).
select tests.create_user('fs-other@t.local', 'FS Other') as other \gset
select tests.create_workspace('FS Other WS', :'other') as ws_o \gset
select tests.act_as(:'other');
select is((select count(*)::int from public.workout_sets where id = :'s2'), 0,
  'a coach of another workspace cannot see the F set');
reset role;

select * from finish();
rollback;
