begin;
select plan(8);

-- 20261110007200: award_inputs sends a log exercise's own measurements (so the award function counts what was
-- logged), an old doc that swaps the exercise drops the stale override, and a save can skip remembering choices
-- (Duplicate).
select tests.create_user('mf-coach@t.local', 'MF Coach') as coach \gset
select tests.create_user('mf-client@t.local', 'MF Client') as client \gset
select tests.create_workspace('MF Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'client');
select tests.create_exercise(null, 'MF Lunge') as ex \gset
select tests.create_exercise(null, 'MF Row') as ex2 \gset

-- ---------- award_inputs ----------
select tests.create_log(:'ws', :'client') as l \gset
update public.log_exercises set tracking_type = 'weight_reps_time', each_side = true, tempo = '3-1-1-0'
where log_id = :'l';
update public.workout_logs set status = 'completed', finished_at = now() where id = :'l';
select is(
  (select e -> 'tracking_type' from jsonb_path_query(public.award_inputs(:'l'), '$.logs[*].log_blocks[*].log_exercises[*]') e limit 1),
  '"weight_reps_time"'::jsonb, 'award_inputs sends the log exercise''s own measurements');
select is(
  (select jsonb_build_array(e -> 'each_side', e -> 'tempo') from jsonb_path_query(public.award_inputs(:'l'), '$.logs[*].log_blocks[*].log_exercises[*]') e limit 1),
  '[true, "3-1-1-0"]'::jsonb, 'and its Each side and Tempo');
select is(
  (select e #> '{exercises,tracking_type}' from jsonb_path_query(public.award_inputs(:'l'), '$.logs[*].log_blocks[*].log_exercises[*]') e limit 1),
  '"weight_reps"'::jsonb, 'the library kind is still there for logs without one');

-- ---------- save_workout ----------
\set w '5f100000-0000-4000-8000-000000000001'
\set e1 '5f100000-0000-4000-8000-0000000000e1'
create function pg_temp.doc(p_ex uuid, p_opts jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', '5f100000-0000-4000-8000-000000000001', 'name', 'MF Legs', 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', '5f100000-0000-4000-8000-0000000000b1', 'kind', 'straight',
      'exercises', jsonb_build_array(jsonb_build_object('id', '5f100000-0000-4000-8000-0000000000e1',
        'exerciseId', p_ex, 'exerciseName', 'x', 'note', null, 'sets', jsonb_build_array(jsonb_build_object(
          'id', '5f100000-0000-4000-8000-000000000501', 'setType', 'normal', 'targetRepsMin', 8, 'targetRepsMax', 8,
          'targetWeightKg', 20, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', false,
          'restSeconds', 60, 'note', null))) || p_opts))));
$$;
grant execute on function pg_temp.doc(uuid, jsonb) to authenticated;

select tests.act_as(:'coach');
-- A duplicate (rememberChoices false) writes no remembered choice.
select public.save_workout(:'ws', pg_temp.doc(:'ex', '{"trackingType":"weight_reps_time","eachSide":true,"tempo":null}')
  || '{"rememberChoices":false}');
select is((select count(*)::int from public.exercise_prefs where workspace_id = :'ws'), 0,
  'a save with rememberChoices false leaves the remembered choices alone');
select is((select tracking_type::text from public.workout_exercises where id = :'e1'), 'weight_reps_time',
  'it still saves the workout''s own measurements');
select public.save_workout(:'ws', pg_temp.doc(:'ex', '{"trackingType":"weight_reps_time","eachSide":false,"tempo":null}'));
select results_eq(format($$select tracking_type::text, each_side from public.exercise_prefs where workspace_id = %L$$, :'ws'),
  $$values ('weight_reps_time'::text, false)$$, 'a normal save that changes them remembers them');

-- An old doc (no eachSide) that swaps the exercise: the old exercise's override and Each side don't carry over.
select public.save_workout(:'ws', pg_temp.doc(:'ex', '{"trackingType":"weight_reps_time","eachSide":true,"tempo":"3-1-1-0"}'));
select public.save_workout(:'ws', pg_temp.doc(:'ex2', '{"trackingType":"weight_reps"}'));
select results_eq(format($$select exercise_id, tracking_type::text from public.workout_exercises where id = %L$$, :'e1'),
  format($$values (%L::uuid, null::text)$$, :'ex2'),
  'swapping the exercise from an old doc drops the stale measurements');
select results_eq(format($$select each_side, tempo from public.workout_exercises where id = %L$$, :'e1'),
  $$values (false, '3-1-1-0'::text)$$, '...and the stale Each side, keeping the slot''s tempo');
reset role;

select * from finish();
rollback;
