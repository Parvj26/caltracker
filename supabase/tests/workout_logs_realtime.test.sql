begin;
select plan(9);

-- Live updates for the coach: workout_logs is in the Realtime publication, and Realtime only forwards a change to
-- subscribers whose SELECT policies allow the row. These checks run the same SELECT a subscriber's change goes
-- through, so they prove a coach of another workspace, and another client, never hear about the change.

select tests.create_user('rt-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('rt-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('rt-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('rt-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('RT Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('RT Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.create_exercise(null, 'RT Builtin') as ex \gset

select gen_random_uuid() as log_id \gset
select gen_random_uuid() as block_id \gset
select gen_random_uuid() as le_id \gset
select gen_random_uuid() as set_id \gset

-- Publication and replica identity.
select is((select count(*)::int from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workout_logs'), 1,
  'workout_logs is in the realtime publication');
select is((select relreplident::text from pg_class where oid = 'public.workout_logs'::regclass), 'd',
  'workout_logs keeps the default replica identity (filters only read the new row)');
select ok((select relrowsecurity from pg_class where oid = 'public.workout_logs'::regclass), 'workout_logs still has RLS on');

-- The phone starts a workout, then ticks off a set: each save updates the log row, which is what the web listens to.
create function tests.rt_doc(revision int, done boolean, status text) returns jsonb
language sql as $$
  select jsonb_build_object('id', current_setting('rt.log'), 'workoutId', null, 'name', 'Live', 'status', status,
    'startedAt', now() - interval '20 minutes', 'finishedAt', null, 'lastActivityAt', now(),
    'autoFinished', false, 'revision', revision, 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', current_setting('rt.block'), 'kind', 'straight',
      'exercises', jsonb_build_array(jsonb_build_object('id', current_setting('rt.le'),
        'exerciseId', current_setting('rt.ex'), 'exerciseName', 'ignored', 'trackingType', 'weight_reps',
        'plannedWorkoutExerciseId', null, 'swappedFromExerciseId', null, 'note', null,
        'sets', jsonb_build_array(jsonb_build_object('id', current_setting('rt.set'), 'setType', 'normal',
          'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 60, 'durationS', null,
            'distanceM', null, 'toFailure', false, 'restSeconds', 90),
          'actualReps', case when done then 8 end, 'actualWeightKg', case when done then 60 end,
          'actualDurationS', null, 'actualDistanceM', null,
          'completedAt', case when done then to_jsonb(now()) else 'null'::jsonb end)))))));
$$;
select set_config('rt.log', :'log_id', true), set_config('rt.block', :'block_id', true),
  set_config('rt.le', :'le_id', true), set_config('rt.set', :'set_id', true), set_config('rt.ex', :'ex', true);

select tests.rt_doc(1, false, 'in_progress') as doc_started \gset
select tests.rt_doc(2, true, 'in_progress') as doc_ticked \gset
select tests.act_as(:'a1');
select public.save_workout_log(:'doc_started'::jsonb);
select public.save_workout_log(:'doc_ticked'::jsonb);
reset role;
select is((select revision from public.workout_logs where id = :'log_id'), 2,
  'ticking a set off updates the workout_logs row (so Realtime sends an UPDATE)');

-- Who a change to that row reaches.
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.workout_logs where id = :'log_id' and workspace_id = :'ws_a'), 1,
  'the client''s coach receives the change');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.workout_logs where id = :'log_id'), 1, 'the client receives their own change');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.workout_logs where id = :'log_id'), 0,
  'a coach of another workspace does not receive it, even subscribed with the other workspace id');
select is((select count(*)::int from public.workout_logs where workspace_id = :'ws_a'), 0,
  'a coach of another workspace sees nothing for that workspace');
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from public.workout_logs where id = :'log_id'), 0,
  'another client of the same coach does not receive it');
reset role;

select * from finish();
rollback;
