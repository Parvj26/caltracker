begin;
select plan(58);

-- Fixtures (as postgres)
select tests.create_user('su-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('su-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('su-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('su-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('su-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('SU Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('SU Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.create_exercise(null, 'SU Lat Pulldown') as ex_lat \gset
select tests.create_exercise(null, 'SU Assisted Pull Up') as ex_assist \gset
select tests.create_exercise(null, 'SU Band Pull Up') as ex_band \gset
select tests.create_exercise(null, 'SU Row') as ex_row \gset
select tests.create_exercise(:'ws_b', 'SU B Custom') as ex_b \gset
select tests.create_exercise(null, 'SU Fourth') as ex_four \gset

create function tests.su_set(id uuid, set_type text, reps int default 8, kg numeric default 50, rest int default 90)
returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'setType', set_type, 'targetRepsMin', reps, 'targetRepsMax', reps,
    'targetWeightKg', kg, 'targetDurationS', null, 'targetDistanceM', null, 'toFailure', false,
    'restSeconds', rest, 'note', null);
$$;
create function tests.su_sub(id uuid, exercise_id uuid, sets jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'exerciseId', exercise_id, 'exerciseName', 'ignored',
    'trackingType', 'weight_reps', 'note', 'If the machine is taken', 'sets', sets);
$$;
create function tests.su_ex(id uuid, exercise_id uuid, sets jsonb, subs jsonb default '[]') returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'exerciseId', exercise_id, 'exerciseName', 'ignored',
    'trackingType', 'weight_reps', 'note', null, 'sets', sets, 'substitutes', subs);
$$;
create function tests.su_doc(id uuid, kind text, exercises jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', id, 'name', 'Back', 'notes', null, 'blocks',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', kind, 'exercises', exercises)));
$$;
-- The SQLSTATE a save_workout fails with, or 'ok'.
create function tests.su_save_error(ws uuid, doc jsonb) returns text
language plpgsql as $$
begin
  perform public.save_workout(ws, doc);
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
-- Rows a statement changed (RLS hides rows, so a refused update or delete changes none).
create function tests.su_rows(q text) returns int
language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on all functions in schema tests to authenticated;

\set w1 '5b000000-0000-4000-8000-000000000001'
\set e1 '5b000000-0000-4000-8000-0000000000e1'
\set sub1 '5b000000-0000-4000-8000-0000000000f1'
\set sub2 '5b000000-0000-4000-8000-0000000000f2'

-- Lat Pulldown (2 sets) with substitutes Assisted Pull Up (2 sets, a drop given rest on purpose) and Band Pull Up.
select tests.su_doc(:'w1', 'straight', jsonb_build_array(tests.su_ex(:'e1', :'ex_lat',
  jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal'), tests.su_set(gen_random_uuid(), 'normal')),
  jsonb_build_array(
    tests.su_sub(:'sub1', :'ex_assist', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal', 8, 30),
      tests.su_set(gen_random_uuid(), 'drop', 8, 20, 60))),
    tests.su_sub(:'sub2', :'ex_band', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal', 10, null))))
))) as doc \gset

-- ---------------------------------------------------------------------------------------------------- plans
select tests.act_as(:'coach_a');
select is(public.save_workout(:'ws_a', :'doc'), :'w1'::uuid, 'the coach saves a workout with substitutes');
select results_eq(
  format($$select exercise_id, position::int, note, jsonb_array_length(sets) from public.workout_substitutes
    where workout_exercise_id = %L order by position$$, :'e1'),
  format($$values (%L::uuid, 0, 'If the machine is taken', 2), (%L::uuid, 1, 'If the machine is taken', 1)$$,
    :'ex_assist', :'ex_band'),
  'each substitute is stored in order with its own sets');
select is((select workspace_id from public.workout_substitutes where id = :'sub1'), :'ws_a'::uuid,
  'the owner columns come from the parent exercise');
select is((select (sets -> 1 ->> 'restSeconds')::int from public.workout_substitutes where id = :'sub1'), 0,
  'a substitute drop set has no rest');
-- Saving again unchanged, then without the second substitute.
select is(public.save_workout(:'ws_a', :'doc'), :'w1'::uuid, 'saving the same doc again is fine');
select public.save_workout(:'ws_a', jsonb_set(:'doc', '{blocks,0,exercises,0,substitutes}',
  jsonb_build_array((:'doc'::jsonb) #> '{blocks,0,exercises,0,substitutes,0}')));
select is((select count(*)::int from public.workout_substitutes where workout_id = :'w1'), 1,
  'a substitute the doc no longer has is deleted');
select public.save_workout(:'ws_a', :'doc');
-- Swapping the exercise for one of its own substitutes: save_workout prunes that substitute, so the deferred
-- rules pass once checked.
select public.save_workout(:'ws_a', jsonb_set(jsonb_set(:'doc', '{blocks,0,exercises,0,exerciseId}', to_jsonb(:'ex_assist'::text)),
  '{blocks,0,exercises,0,substitutes}', jsonb_build_array((:'doc'::jsonb) #> '{blocks,0,exercises,0,substitutes,1}')));
select lives_ok('set constraints all immediate', 'replacing an exercise with its own substitute passes the substitute rules');
set constraints all deferred;
select results_eq(format($$select exercise_id from public.workout_substitutes where workout_exercise_id = %L$$, :'e1'),
  format($$values (%L::uuid)$$, :'ex_band'), 'and the substitute that became the exercise is gone');
select public.save_workout(:'ws_a', :'doc');
-- An older doc (no "substitutes" key) still saves, and has none.
select is(public.save_workout(:'ws_a', tests.su_doc(gen_random_uuid(), 'straight', jsonb_build_array(
  (tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')))) - 'substitutes'
))) is not null, true, 'a doc from before substitutes still saves');

-- Document guards.
select matches(tests.su_save_error(:'ws_a', tests.su_doc(gen_random_uuid(), 'choice', jsonb_build_array(
  tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')),
    jsonb_build_array(tests.su_sub(gen_random_uuid(), :'ex_band', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal'))))),
  tests.su_ex(gen_random_uuid(), :'ex_lat', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')))))),
  '^23514: A pick-one group''s exercises can''t have substitutes', 'no substitutes inside a pick-one group');
select matches(tests.su_save_error(:'ws_a', tests.su_doc(gen_random_uuid(), 'straight', jsonb_build_array(
  tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')),
    (select jsonb_agg(tests.su_sub(gen_random_uuid(), x, jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal'))))
     from unnest(array[:'ex_lat', :'ex_assist', :'ex_band', :'ex_four']::uuid[]) x))))),
  '^23514: Use at most 3 substitutes', 'at most 3 substitutes');
select matches(tests.su_save_error(:'ws_a', tests.su_doc(gen_random_uuid(), 'straight', jsonb_build_array(
  tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')),
    jsonb_build_array(tests.su_sub(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')))))))),
  '^23514: A substitute must be a different exercise', 'a substitute is not the exercise itself');
select matches(tests.su_save_error(:'ws_a', tests.su_doc(gen_random_uuid(), 'straight', jsonb_build_array(
  tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')),
    jsonb_build_array(tests.su_sub(gen_random_uuid(), :'ex_band', '[]'::jsonb)))))),
  '^23514: Every substitute needs 1 to 20 sets', 'a substitute needs sets');
select matches(tests.su_save_error(:'ws_a', tests.su_doc(gen_random_uuid(), 'straight', jsonb_build_array(
  tests.su_ex(gen_random_uuid(), :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')),
    jsonb_build_array(tests.su_sub(gen_random_uuid(), :'ex_b', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal')))))))),
  '^42501', 'a substitute cannot be another workspace''s custom exercise');
select matches(tests.su_save_error(:'ws_a', jsonb_set(:'doc', '{blocks,0,exercises,0,substitutes,0,id}',
  to_jsonb(:'e1'::text))), '^23514: Row .* appears twice', 'substitute ids are checked for duplicates too');

-- Direct writes are held to the same rules as save_workout (constraint triggers are checked here at once).
set constraints all immediate;
reset role;
create function tests.su_sets(over jsonb) returns jsonb
language sql as $$ select jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal') || over); $$;
grant execute on all functions in schema tests to authenticated;
select tests.act_as(:'coach_a');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', tests.su_sets('{"id": "not-a-uuid"}')), '23514', null,
  'a substitute set needs a uuid id');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', tests.su_sets('{"id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}')), '23514', null,
  'and an RFC one (version 1-8, variant 8-b), as zod checks');
select ok(not has_function_privilege('anon', 'public.valid_substitute_sets(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.uuid_text_ok(text)', 'execute')
  and has_function_privilege('authenticated', 'public.valid_substitute_sets(jsonb)', 'execute'),
  'anon cannot call the substitute validators');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', tests.su_sets('{"targetRepsMin": 12, "targetRepsMax": 8}')), '23514', null,
  'minimum reps can''t be more than maximum reps');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', tests.su_sets('{"targetWeightKg": 5000}')), '23514', null,
  'targets stay in range');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', tests.su_sets('{"toFailure": true}')), '23514', null,
  'only drop sets can be to failure');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'drop', 8, 20, 0))),
  '23514', null, 'a substitute''s first set is not a drop');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_lat', tests.su_sets('{}')), '23514',
  'A substitute must be a different exercise.', 'a direct insert cannot make the planned exercise its own substitute');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, %L)$$, :'e1', :'ex_assist', tests.su_sets('{}')), '23505', null,
  'nor add the same substitute twice');
select throws_ok(format($$update public.workout_substitutes set exercise_id = %L where id = %L$$, :'ex_b', :'sub1'),
  '42501', null, 'the coach cannot point a substitute at another workspace''s custom exercise');
select throws_ok(format($$update public.workout_blocks set kind = 'choice' where workout_id = %L$$, :'w1'), '23514',
  'A pick-one group''s exercises can''t have substitutes.', 'a block with substitutes cannot become a pick-one group');
\set c1 '5b000000-0000-4000-8000-0000000000c1'
\set ce1 '5b000000-0000-4000-8000-0000000000c2'
select public.save_workout(:'ws_a', tests.su_doc(:'c1', 'choice', jsonb_build_array(
  tests.su_ex(:'ce1', :'ex_row', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal'))),
  tests.su_ex(gen_random_uuid(), :'ex_lat', jsonb_build_array(tests.su_set(gen_random_uuid(), 'normal'))))));
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 0, %L, %L)$$, :'ce1', :'ex_band', tests.su_sets('{}')), '23514',
  'A pick-one group''s exercises can''t have substitutes.', 'a direct insert cannot put a substitute on a pick-one option');
set constraints all deferred;
select matches(tests.su_save_error(:'ws_a', jsonb_set(:'doc', '{blocks,0,exercises,0,substitutes,1,sets,0,id}',
  (:'doc'::jsonb) #> '{blocks,0,exercises,0,substitutes,0,sets,0,id}')), '^23514: Row .* appears twice',
  'substitute set ids are checked for duplicates too');

-- ------------------------------------------------------------------------------------- cross-workspace RLS
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.workout_substitutes where workout_id = :'w1'), 0,
  'another workspace''s coach sees none of its substitutes');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  values (%L, 2, %L, '[{}]')$$, :'e1', :'ex_row'), '42501', null, 'another workspace''s coach cannot add a substitute');
select is(tests.su_rows(format($q$update public.workout_substitutes set note = 'hijack' where workout_id = %L$q$, :'w1')), 0, 'another workspace''s coach cannot change a substitute');
select is(tests.su_rows(format($q$delete from public.workout_substitutes where workout_id = %L$q$, :'w1')), 0, 'another workspace''s coach cannot delete a substitute');
select matches(tests.su_save_error(:'ws_b', :'doc'), '^42501', 'nor overwrite the workout through save_workout');

-- -------------------------------------------------------------------------------------------- copies
select tests.act_as(:'coach_a');
select gen_random_uuid() as inst \gset
select is(public.schedule_workout(:'inst', :'w1', :'a1', '2026-11-20'), :'inst'::uuid, 'the coach schedules it');
select results_eq(
  format($$select exercise_id, position::int from public.workout_substitutes where workout_id = %L order by position$$, :'inst'),
  format($$values (%L::uuid, 0), (%L::uuid, 1)$$, :'ex_assist', :'ex_band'),
  'the scheduled copy keeps the substitutes');
select ok((select bool_and(c.client_id = :'a1'::uuid and c.id <> o.id and c.sets -> 0 ->> 'id' <> o.sets -> 0 ->> 'id'
    and c.sets - 0 is not null and (c.sets -> 0 ->> 'targetWeightKg')::numeric = (o.sets -> 0 ->> 'targetWeightKg')::numeric)
  from public.workout_substitutes c join public.workout_substitutes o on o.workout_id = :'w1' and o.position = c.position
  where c.workout_id = :'inst'), 'the copy is the client''s, with new row and set ids and the same targets');

-- --------------------------------------------------------------------------------------- cross-client RLS
select tests.act_as(:'a1');
select is((select count(*)::int from public.workout_substitutes where workout_id = :'inst'), 2,
  'the client sees the substitutes of their own workout');
select is((select count(*)::int from public.workout_substitutes where workout_id = :'w1'), 0,
  'but not the library workout''s');
select throws_ok(format($$insert into public.workout_substitutes (workout_exercise_id, position, exercise_id, sets)
  select workout_exercise_id, 2, %L, sets from public.workout_substitutes where workout_id = %L limit 1$$,
  :'ex_row', :'inst'), '42501', null, 'a client cannot add a substitute');
select is(tests.su_rows(format($q$update public.workout_substitutes set note = 'mine' where workout_id = %L$q$, :'inst')), 0, 'a client cannot change a substitute');
select is(tests.su_rows(format($q$delete from public.workout_substitutes where workout_id = %L$q$, :'inst')), 0, 'a client cannot delete a substitute');
select tests.act_as(:'a2');
select is((select count(*)::int from public.workout_substitutes where workout_id = :'inst'), 0,
  'another client of the same coach sees none of them');
select tests.act_as(:'b1');
select is((select count(*)::int from public.workout_substitutes), 0, 'a client of another workspace sees none');
select tests.act_as_anon();
select throws_ok('select count(*) from public.workout_substitutes', '42501', null, 'anon cannot read substitutes');

-- ----------------------------------------------------------------------------------------------- logs
reset role;
select id as inst_we from public.workout_exercises where workout_id = :'inst' \gset
select id as inst_sub from public.workout_substitutes where workout_id = :'inst' and position = 0 \gset
select gen_random_uuid() as log1 \gset
-- The client did the substitute (Assisted Pull Up) instead of Lat Pulldown.
create function tests.su_log(log_id uuid, workout_id uuid, ex jsonb, status text default 'completed') returns jsonb
language sql as $$
  select jsonb_build_object('id', log_id, 'workoutId', workout_id, 'name', 'Back', 'status', status,
    'startedAt', now() - interval '1 hour', 'finishedAt', now() - interval '5 minutes',
    'lastActivityAt', now() - interval '5 minutes', 'autoFinished', false, 'revision', 1, 'notes', null,
    'blocks', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'straight',
      'exercises', jsonb_build_array(ex))));
$$;
create function tests.su_log_ex(exercise_id uuid, planned uuid, substitute_id uuid, options jsonb) returns jsonb
language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'exerciseId', exercise_id, 'exerciseName', 'ignored',
    'trackingType', 'weight_reps', 'plannedWorkoutExerciseId', planned, 'swappedFromExerciseId', null,
    'note', null, 'substituteId', substitute_id, 'substituteOptions', options,
    'sets', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'setType', 'normal',
      'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 30, 'durationS', null, 'distanceM', null,
        'toFailure', false, 'restSeconds', 90),
      'actualReps', 8, 'actualWeightKg', 30, 'actualDurationS', null, 'actualDistanceM', null,
      'completedAt', now() - interval '10 minutes')));
$$;
create function tests.su_log_error(doc jsonb) returns text
language plpgsql as $$
begin
  perform public.save_workout_log(doc);
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on all functions in schema tests to authenticated;
select jsonb_build_array(
  jsonb_build_object('substituteId', null, 'exerciseId', :'ex_lat', 'exerciseName', 'SU Lat Pulldown',
    'trackingType', 'weight_reps', 'sets', jsonb_build_array(jsonb_build_object('setType', 'normal',
      'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 50, 'durationS', null, 'distanceM', null,
        'toFailure', false, 'restSeconds', 90)))),
  jsonb_build_object('substituteId', :'inst_sub', 'exerciseId', :'ex_assist', 'exerciseName', 'SU Assisted Pull Up',
    'trackingType', 'weight_reps', 'sets', jsonb_build_array(jsonb_build_object('setType', 'normal',
      'target', jsonb_build_object('repsMin', 8, 'repsMax', 8, 'weightKg', 30, 'durationS', null, 'distanceM', null,
        'toFailure', false, 'restSeconds', 90))))
) as options \gset

select tests.act_as(:'a1');
select is(public.save_workout_log(tests.su_log(:'log1', :'inst',
  tests.su_log_ex(:'ex_assist', :'inst_we', :'inst_sub', :'options'))) ->> 'applied', 'true',
  'the client saves a log that did the substitute');
select results_eq(format($$select exercise_id, substitute_id, jsonb_array_length(substitute_options)
    from public.log_exercises where log_id = %L$$, :'log1'),
  format($$values (%L::uuid, %L::uuid, 2)$$, :'ex_assist', :'inst_sub'),
  'the log exercise is the substitute done, with its options');
select matches(tests.su_log_error(tests.su_log(gen_random_uuid(), :'inst',
  tests.su_log_ex(:'ex_assist', :'inst_we', gen_random_uuid(), :'options'))),
  '^23514: The substitute must be one of the options', 'an unknown substitute is refused');
select matches(tests.su_log_error(tests.su_log(gen_random_uuid(), :'inst',
  tests.su_log_ex(:'ex_lat', :'inst_we', null, jsonb_set(:'options', '{1,sets,0,completedAt}', to_jsonb(now()))))),
  '^23514: Only the exercise being done can have done sets', 'an option not being done cannot have done sets');
select matches(tests.su_log_error(tests.su_log(gen_random_uuid(), :'inst',
  tests.su_log_ex(:'ex_lat', :'inst_we', null, jsonb_set(:'options', '{1,trackingType}', '"yoga"')))),
  '^23514: A substitute option is not valid', 'a malformed substitute option is refused');
-- An option whose exercise the workspace can't use (another workspace's, or deleted since) is left out, not refused:
-- refusing would make every save of the phone's workout fail for good.
select gen_random_uuid() as log_strip \gset
select is(public.save_workout_log(tests.su_log(:'log_strip', :'inst',
  tests.su_log_ex(:'ex_lat', :'inst_we', null, jsonb_set(:'options', '{1,exerciseId}', to_jsonb(:'ex_b'::text))), 'in_progress')) ->> 'applied',
  'true', 'a log with an option naming an exercise the workspace can''t use still saves');
select is((select jsonb_path_query_array(substitute_options, '$[*].exerciseId') from public.log_exercises where log_id = :'log_strip'),
  jsonb_build_array(:'ex_lat'::text), 'and that option is left out');
select gen_random_uuid() as log_old \gset
select is(public.save_workout_log(tests.su_log(:'log_old', null,
  tests.su_log_ex(:'ex_row', null, null, '[]') - 'substituteId' - 'substituteOptions')) ->> 'applied', 'true',
  'a log from before substitutes still saves');
select results_eq(format($$select substitute_id, substitute_options from public.log_exercises where log_id = %L$$, :'log_old'),
  $$values (null::uuid, '[]'::jsonb)$$, 'and stores no substitute');
select ok(exists (select 1 from public.recent_exercises_for_client() r where r.exercise_id = :'ex_assist')
  and not exists (select 1 from public.recent_exercises_for_client() r where r.exercise_id = :'ex_lat'),
  'recent exercises list the substitute done, not the planned exercise');

reset role;
select ok(jsonb_path_exists(public.award_inputs(:'log1'),
    '$.logs[*] ? (@.id == $l).log_blocks[*].log_exercises[*] ? (@.exercise_id == $x)',
    jsonb_build_object('l', :'log1', 'x', :'ex_assist'))
  and not jsonb_path_exists(public.award_inputs(:'log1'),
    '$.logs[*] ? (@.id == $l).log_blocks[*].log_exercises[*] ? (@.exercise_id == $x)',
    jsonb_build_object('l', :'log1', 'x', :'ex_lat')),
  'award inputs count the substitute done, not the planned exercise');

-- A removed client no longer sees the substitutes of their copy.
select tests.act_as(:'coach_a');
select public.remove_client(:'ws_a', :'a1');
select tests.act_as(:'a1');
select is((select count(*)::int from public.workout_substitutes where workout_id = :'inst'), 0,
  'a removed client sees none of their old workout''s substitutes');

-- Deleting a workspace takes its substitutes with it (their exercises restrict deletes, so order matters).
reset role;
select lives_ok(format($$delete from public.workspaces where id = %L$$, :'ws_a'), 'a workspace with substitutes can be deleted');
select is((select count(*)::int from public.workout_substitutes where workout_id in (:'w1', :'inst')), 0,
  'and its substitutes are gone');

select * from finish();
rollback;
