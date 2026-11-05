begin;
select plan(14);

-- Fixtures (as postgres)
select tests.create_user('af-coach@t.local', 'Coach') as coach \gset
select tests.create_user('af-1@t.local', 'Client 1') as c1 \gset
select tests.create_user('af-2@t.local', 'Client 2') as c2 \gset
select tests.create_user('af-3@t.local', 'Client 3') as c3 \gset
select tests.create_workspace('AF Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'c1');
select tests.add_client(:'ws', :'c2');
select tests.add_client(:'ws', :'c3');

-- L1: idle 4 h, two sets completed at T-4h10m and T-4h05m.
select tests.create_log(:'ws', :'c1', null, 'in_progress') as l1 \gset
update public.log_sets set completed_at = now() - interval '4 hours 10 minutes' where log_id = :'l1' and position = 0;
update public.log_sets set completed_at = now() - interval '4 hours 5 minutes' where log_id = :'l1' and position = 1;
update public.workout_logs set last_activity_at = now() - interval '4 hours', revision = 3 where id = :'l1';
-- L2: idle 4 h, nothing completed.
select tests.create_log(:'ws', :'c2', null, 'in_progress') as l2 \gset
update public.log_sets set completed_at = null where log_id = :'l2';
update public.workout_logs set last_activity_at = now() - interval '4 hours', revision = 0 where id = :'l2';
-- L3: idle 2 h, left alone.
select tests.create_log(:'ws', :'c3', null, 'in_progress') as l3 \gset
update public.workout_logs set last_activity_at = now() - interval '2 hours' where id = :'l3';

select ok(not has_function_privilege('authenticated', 'public.auto_finish_stale_logs()', 'execute'),
  'authenticated cannot run the auto-finish job');
select ok(has_function_privilege('service_role', 'public.auto_finish_stale_logs()', 'execute'),
  'service_role can run the auto-finish job');

select is(public.auto_finish_stale_logs(), 2, 'the job changes the two stale logs');

select results_eq(format($q$select status::text, finished_at, auto_finished from public.workout_logs where id = %L$q$, :'l1'),
  format($q$select 'completed', %L::timestamptz, true$q$, (select now() - interval '4 hours 5 minutes')),
  'L1 is completed at its last set time and marked auto-finished');
select is((select revision from public.workout_logs where id = :'l1'), 3, 'L1 revision is untouched');
select is((select last_activity_at from public.workout_logs where id = :'l1'), now() - interval '4 hours',
  'L1 last activity is untouched');
select is((select status::text from public.workout_logs where id = :'l2'), 'discarded', 'L2 is discarded');
select ok((select auto_finished from public.workout_logs where id = :'l2'), 'L2 is marked auto-finished');
select is((select revision from public.workout_logs where id = :'l2'), 0, 'L2 revision is untouched');
select results_eq(format($q$select status::text, auto_finished, revision, finished_at is null from public.workout_logs where id = %L$q$, :'l3'),
  $q$values ('in_progress', false, 0, true)$q$, 'L3 (idle 2 h) is unchanged');
select is(public.auto_finish_stale_logs(), 0, 'running again changes nothing');

select is((select count(*)::int from cron.job where jobname = 'auto-finish-stale-logs'), 1,
  'exactly one scheduled job');
select is((select schedule from cron.job where jobname = 'auto-finish-stale-logs'), '7 * * * *', 'it runs at minute 7 every hour');

-- Compatibility with save_workout_log's unlock rule: the phone still uploads its data for an auto-discarded log.
select id as l2_block from public.log_blocks where log_id = :'l2' \gset
select id as l2_ex from public.log_exercises where log_id = :'l2' \gset
select id as l2_set from public.log_sets where log_id = :'l2' and position = 0 \gset
select exercise_id as l2_exercise from public.log_exercises where id = :'l2_ex' \gset
select jsonb_build_object('id', :'l2', 'workoutId', null, 'name', 'Logged', 'status', 'completed',
  'startedAt', now() - interval '5 hours', 'finishedAt', null, 'lastActivityAt', now() - interval '4 hours',
  'autoFinished', false, 'revision', 1, 'notes', null,
  'blocks', jsonb_build_array(jsonb_build_object('id', :'l2_block', 'kind', 'straight', 'exercises',
    jsonb_build_array(jsonb_build_object('id', :'l2_ex', 'exerciseId', :'l2_exercise', 'exerciseName', 'x',
      'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', null, 'swappedFromExerciseId', null, 'note', null,
      'sets', jsonb_build_array(jsonb_build_object('id', :'l2_set', 'setType', 'normal',
        'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 60, 'durationS', null,
          'distanceM', null, 'toFailure', false, 'restSeconds', 90),
        'actualReps', 8, 'actualWeightKg', 60, 'actualDurationS', null, 'actualDistanceM', null,
        'completedAt', to_jsonb(now() - interval '4 hours 30 minutes')))))))) as l2_doc \gset

select tests.act_as(:'c2');
select is(public.save_workout_log(:'l2_doc'::jsonb), '{"applied": true, "revision": 1, "status": "completed"}'::jsonb,
  'the phone can still save an auto-discarded log with a higher revision and a completed set');
reset role;

select * from finish();
rollback;
