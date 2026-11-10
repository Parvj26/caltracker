begin;
select plan(37);

-- Measurements, Each side and Tempo per workout exercise (20261110004100), and exercise_prefs: the coach's last
-- choice per exercise, readable and writable only by coaches of that workspace.
select tests.create_user('wm-coach@t.local', 'WM Coach') as coach \gset
select tests.create_user('wm-other@t.local', 'WM Other Coach') as other \gset
select tests.create_user('wm-client@t.local', 'WM Client') as client \gset
select tests.create_workspace('WM Workspace', :'coach') as ws \gset
select tests.create_workspace('WM Other', :'other') as ws2 \gset
select tests.add_client(:'ws', :'client');
select tests.create_exercise(null, 'WM Lunge') as ex \gset
select tests.create_exercise(null, 'WM Run', 'distance') as run \gset
select tests.create_exercise(:'ws', 'WM Custom') as custom \gset

-- ---------- Structure ----------
select has_column('public', 'workout_exercises', 'tracking_type', 'workout_exercises.tracking_type exists');
select col_default_is('public', 'workout_exercises', 'each_side', 'false', 'each_side defaults to false');
select has_column('public', 'log_exercises', 'tempo', 'log_exercises.tempo exists');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.exercise_prefs'::regclass),
  'exercise_prefs has RLS');
select table_privs_are('public', 'exercise_prefs', 'anon', array[]::text[], 'anon has no privileges on exercise_prefs');

select tests.create_workout(:'ws', 'WM Plan', ex => :'ex') as w \gset
select id as we from public.workout_exercises where workout_id = :'w' \gset

select throws_ok(format($$update public.workout_exercises set tempo = '3-1-1' where id = %L$$, :'we'),
  '23514', null, 'a tempo needs four parts');
select throws_ok(format($$update public.workout_exercises set tempo = '3-1-x-0' where id = %L$$, :'we'),
  '23514', null, 'a tempo is stored normalised (capital X)');
select lives_ok(format($$update public.workout_exercises set tempo = '3-1-X-0' where id = %L$$, :'we'),
  'a normalised tempo is fine');
select throws_ok(format($$update public.workout_exercises set tracking_type = 'distance' where id = %L$$, :'we'),
  '23514', null, 'distance is never a picked measurement');
select throws_ok(format($$update public.exercises set tracking_type = 'weight_reps_time' where id = %L$$, :'custom'),
  '23514', null, 'a library exercise keeps one of the five library kinds');

-- ---------- save_workout ----------
\set w2 '5e000000-0000-4000-8000-000000000001'
\set b1 '5e000000-0000-4000-8000-0000000000b1'
\set e1 '5e000000-0000-4000-8000-0000000000e1'
\set e2 '5e000000-0000-4000-8000-0000000000e2'
\set b2 '5e000000-0000-4000-8000-0000000000b2'
create function pg_temp.doc(p_ex jsonb, p_run jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('id', '5e000000-0000-4000-8000-000000000001', 'name', 'WM Legs', 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', '5e000000-0000-4000-8000-0000000000b1', 'kind', 'straight',
      'exercises', jsonb_build_array(p_ex)))
    || case when p_run is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'id', '5e000000-0000-4000-8000-0000000000b2', 'kind', 'straight', 'exercises', jsonb_build_array(p_run))) end);
$$;
create function pg_temp.ex(p_id text, p_ex uuid, p_opts jsonb, p_set text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'exerciseId', p_ex, 'exerciseName', 'x', 'note', null, 'sets',
    jsonb_build_array(jsonb_build_object('id', p_set, 'setType', 'normal', 'targetRepsMin', 8, 'targetRepsMax', 8,
      'targetWeightKg', 20, 'targetDurationS', 30, 'targetDistanceM', null, 'toFailure', false, 'restSeconds', 60,
      'note', null))) || p_opts;
$$;
grant execute on function pg_temp.doc(jsonb, jsonb), pg_temp.ex(text, uuid, jsonb, text) to authenticated;

select tests.act_as(:'coach');
select is(public.save_workout(:'ws', pg_temp.doc(
    pg_temp.ex(:'e1', :'ex', '{"trackingType":"weight_reps_time","eachSide":true,"tempo":"3-1-1-0"}',
      '5e000000-0000-4000-8000-000000000501'),
    pg_temp.ex(:'e2', :'run', '{"trackingType":"time","eachSide":false,"tempo":null}',
      '5e000000-0000-4000-8000-000000000502'))),
  :'w2'::uuid, 'save_workout saves measurements, Each side and Tempo');
select results_eq(format($$select tracking_type::text, each_side, tempo from public.workout_exercises where id = %L$$, :'e1'),
  $$values ('weight_reps_time'::text, true, '3-1-1-0'::text)$$, 'they read back');
select is((select target_duration_s from public.workout_sets where workout_exercise_id = :'e1'), 30, 'the time target is kept');
select is((select tracking_type::text from public.workout_exercises where id = :'e2'), null,
  'a distance exercise keeps its kind whatever the doc says');

-- The pick equals the library kind: stored as null (it follows the library).
select public.save_workout(:'ws', pg_temp.doc(
  pg_temp.ex(:'e1', :'ex', '{"trackingType":"weight_reps","eachSide":true,"tempo":"3-1-1-0"}',
    '5e000000-0000-4000-8000-000000000501')));
select is((select tracking_type::text from public.workout_exercises where id = :'e1'), null,
  'measurements equal to the library kind are stored as null');

select public.save_workout(:'ws', pg_temp.doc(
  pg_temp.ex(:'e1', :'ex', '{"trackingType":"reps_time","eachSide":true,"tempo":"4-0-X-0"}',
    '5e000000-0000-4000-8000-000000000501')));
-- A doc without the keys (an old open tab) keeps what the row has.
select public.save_workout(:'ws', pg_temp.doc(
  pg_temp.ex(:'e1', :'ex', '{"trackingType":"weight_reps"}', '5e000000-0000-4000-8000-000000000501')
    || '{"note":"old tab"}'));
select results_eq(format($$select tracking_type::text, each_side, tempo, note from public.workout_exercises where id = %L$$, :'e1'),
  $$values ('reps_time'::text, true, '4-0-X-0'::text, 'old tab'::text)$$,
  'a doc from before measurements leaves them as they were');
select throws_ok(format($$select public.save_workout(%L, pg_temp.doc(pg_temp.ex(%L, %L,
    '{"trackingType":"weight_reps","eachSide":false,"tempo":"slow"}', '5e000000-0000-4000-8000-000000000501')))$$,
    :'ws', :'e1', :'ex'),
  '23514', null, 'save_workout refuses a tempo that is not valid');

-- ---------- exercise_prefs: written by save_workout ----------
select results_eq(format($$select tracking_type::text, each_side from public.exercise_prefs
    where workspace_id = %L and exercise_id = %L$$, :'ws', :'ex'),
  $$values ('reps_time'::text, true)$$, 'saving remembers the last measurements and Each side for the exercise');
select is((select count(*)::int from public.exercise_prefs where workspace_id = :'ws' and exercise_id = :'run'), 1,
  'every saved exercise gets a remembered choice');
reset role;

-- ---------- exercise_prefs: RLS ----------
select tests.act_as(:'coach');
select is((select count(*)::int from public.exercise_prefs), 2, 'a coach sees their workspace''s choices');
select lives_ok(format($$insert into public.exercise_prefs (workspace_id, exercise_id, each_side) values (%L, %L, true)$$,
  :'ws', :'custom'), 'a coach can remember a choice for their own custom exercise');
reset role;

select tests.act_as(:'other');
select is((select count(*)::int from public.exercise_prefs where workspace_id = :'ws'), 0,
  'another workspace''s coach sees none of them');
select throws_ok(format($$insert into public.exercise_prefs (workspace_id, exercise_id) values (%L, %L)$$, :'ws', :'ex'),
  '42501', null, 'another workspace''s coach cannot add one');
select throws_ok(format($$insert into public.exercise_prefs (workspace_id, exercise_id) values (%L, %L)$$, :'ws2', :'custom'),
  '42501', null, 'a coach cannot remember another workspace''s custom exercise');
update public.exercise_prefs set each_side = false where workspace_id = :'ws';
delete from public.exercise_prefs where workspace_id = :'ws';
reset role;
select is((select count(*)::int from public.exercise_prefs where workspace_id = :'ws' and each_side), 2,
  'another workspace''s coach cannot change or delete them');

select tests.act_as(:'client');
select is((select count(*)::int from public.exercise_prefs), 0, 'a client sees no choices');
select throws_ok(format($$insert into public.exercise_prefs (workspace_id, exercise_id) values (%L, %L)$$, :'ws', :'ex'),
  '42501', null, 'a client cannot add one');
reset role;

select tests.act_as_anon();
select throws_ok('select * from public.exercise_prefs', '42501', null, 'anon cannot read them');
reset role;

-- ---------- Copies: assignment / Live Sync / invite plans all go through copy_workout_children ----------
select tests.create_workout(:'ws', 'WM Copy', :'client', current_date) as target \gset
delete from public.workout_blocks where workout_id = :'target';
select public.copy_workout_children(:'w2', :'target');
select results_eq(format($$select e.tracking_type::text, e.each_side, e.tempo from public.workout_exercises e
    where e.workout_id = %L and e.exercise_id = %L$$, :'target', :'ex'),
  $$values ('reps_time'::text, true, '4-0-X-0'::text)$$, 'a copied workout keeps measurements, Each side and Tempo');

-- ---------- Content hash: unchanged without the new columns, changed by them ----------
select tests.create_workout(:'ws', 'WM Hash', ex => :'ex') as wh \gset
select public.workout_content_hash(:'wh') as h0 \gset
select is(public.workout_content_hash(:'wh'),
  md5(jsonb_build_array('WM Hash', null::text, (
    select jsonb_agg(jsonb_build_array(b.position, b.kind, b.section_id, b.section_name, (
      select jsonb_agg(jsonb_build_array(e.position, e.exercise_id, e.note, (
        select jsonb_agg(jsonb_build_array(s.position, s.set_type, s.target_reps_min, s.target_reps_max,
          s.target_weight_kg, s.target_duration_s, s.target_distance_m, s.to_failure, s.rest_seconds, s.note)
          order by s.position) from public.workout_sets s where s.workout_exercise_id = e.id), '[]'::jsonb))
      from public.workout_exercises e where e.block_id = b.id)))
    from public.workout_blocks b where b.workout_id = :'wh'))::text),
  'a workout without the new columns hashes exactly as before (no resync of existing copies)');
update public.workout_exercises set each_side = true where workout_id = :'wh';
select isnt(public.workout_content_hash(:'wh'), :'h0', 'Each side changes the hash (Live Sync sends it to clients)');
select public.workout_content_hash(:'wh') as h1 \gset
update public.workout_exercises set tracking_type = 'weight_reps_time' where workout_id = :'wh';
select isnt(public.workout_content_hash(:'wh'), :'h1', 'measurements change the hash');

-- ---------- Logs ----------
\set lg '5e000000-0000-4000-8000-00000000a001'
\set lb '5e000000-0000-4000-8000-00000000a0b1'
\set le '5e000000-0000-4000-8000-00000000a0e1'
create function pg_temp.log(p_opts jsonb, p_rev int) returns jsonb language sql as $$
  select jsonb_build_object('id', '5e000000-0000-4000-8000-00000000a001', 'workoutId', null, 'name', 'WM Log',
    'status', 'in_progress', 'startedAt', now(), 'finishedAt', null, 'lastActivityAt', now(), 'autoFinished', false,
    'revision', p_rev, 'notes', null, 'blocks', jsonb_build_array(jsonb_build_object(
      'id', '5e000000-0000-4000-8000-00000000a0b1', 'kind', 'straight', 'sectionId', null, 'pickedExerciseId', null,
      'exercises', jsonb_build_array(jsonb_build_object('id', '5e000000-0000-4000-8000-00000000a0e1',
        'exerciseId', (select id from public.exercises where name = 'WM Lunge'), 'exerciseName', 'x',
        'plannedWorkoutExerciseId', null, 'swappedFromExerciseId', null, 'note', null, 'sets', jsonb_build_array(
          jsonb_build_object('id', '5e000000-0000-4000-8000-00000000a501', 'setType', 'normal', 'target',
            jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 20, 'durationS', 30, 'distanceM', null,
              'toFailure', false, 'restSeconds', 60),
            'actualReps', 8, 'actualWeightKg', 20, 'actualDurationS', 31, 'actualDistanceM', null,
            'completedAt', null))) || p_opts))));
$$;
grant execute on function pg_temp.log(jsonb, int) to authenticated;

select tests.act_as(:'client');
select public.save_workout_log(pg_temp.log('{"trackingType":"weight_reps_time","eachSide":true,"tempo":"3-1-1-0"}', 1));
select results_eq(format($$select tracking_type::text, each_side, tempo from public.log_exercises where id = %L$$, :'le'),
  $$values ('weight_reps_time'::text, true, '3-1-1-0'::text)$$, 'a log stores its plan''s measurements, Each side and Tempo');
select is((select actual_duration_s from public.log_sets where log_exercise_id = :'le'), 31, 'the logged time is kept');
select public.save_workout_log(pg_temp.log('{"trackingType":"weight_reps"}', 2));
select results_eq(format($$select tracking_type::text, each_side, tempo from public.log_exercises where id = %L$$, :'le'),
  $$values ('weight_reps_time'::text, true, '3-1-1-0'::text)$$, 'a save from an older app (no eachSide) keeps them');
select public.save_workout_log(pg_temp.log('{"trackingType":"weight_reps","eachSide":false,"tempo":"nope"}', 3));
select results_eq(format($$select tracking_type::text, each_side, tempo from public.log_exercises where id = %L$$, :'le'),
  $$values (null::text, false, null::text)$$,
  'a newer app''s save sets them; a bad tempo is left out rather than refusing the save');
reset role;

select tests.act_as(:'other');
select is((select count(*)::int from public.log_exercises where id = :'le'), 0,
  'another workspace''s coach still cannot read the log exercise');
reset role;

select * from finish();
rollback;
