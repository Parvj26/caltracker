begin;
select plan(59);

-- Step 2 of movement assessments (migration 20261121002000_assessment_findings.sql): corrective library, muscle marks,
-- "Also check" ticks, exercise picks, and photo uploads for a coach's own exercises.
-- Fixtures (as postgres): workspace A (coach A, clients a1 and a2), workspace B (coach B, client b1).
select tests.create_user('af-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('af-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('af-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('af-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('af-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('AF Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AF Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select tests.create_exercise(:'ws_a', 'DNS Star', 'reps') as dns \gset
select tests.create_exercise(:'ws_b', 'B Own', 'reps') as b_own \gset
select tests.create_exercise(null, 'AF Builtin Walk', 'reps') as builtin \gset

-- ---------- Structure ----------
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.corrective_exercises'::regclass, 'public.corrective_exercise_muscles'::regclass,
    'public.assessment_muscle_marks'::regclass, 'public.assessment_checks'::regclass,
    'public.assessment_exercise_picks'::regclass)),
  'RLS is enabled on all five tables');
select ok(not has_table_privilege('anon', 'public.corrective_exercises', 'select')
  and not has_table_privilege('anon', 'public.assessment_muscle_marks', 'select')
  and not has_table_privilege('anon', 'public.assessment_exercise_picks', 'select')
  and not has_table_privilege('anon', 'public.assessment_checks', 'select')
  and not has_table_privilege('anon', 'public.corrective_exercise_muscles', 'select'), 'anon has no access');
select ok(not has_table_privilege('authenticated', 'public.assessment_muscle_marks', 'update')
  and not has_column_privilege('authenticated', 'public.corrective_exercises', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.corrective_exercises', 'exercise_id', 'update')
  and not has_column_privilege('authenticated', 'public.corrective_exercises', 'created_by', 'insert'),
  'owners and exercises of a corrective row cannot be changed; marks are replaced, never edited in place');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('save_corrective_exercise', 'save_assessment_review', 'save_assessment_picks')),
  'the new functions run as the caller (no security definer)');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('save_corrective_exercise', 'save_assessment_review', 'save_assessment_picks')),
  'the functions pin an empty search_path');
select ok(not has_function_privilege('anon', 'public.save_assessment_review(uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_assessment_picks(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_corrective_exercise(uuid, uuid, uuid, text, smallint, smallint, smallint, boolean, jsonb)', 'execute'),
  'anon cannot call them');

-- ---------- Corrective library ----------
select tests.act_as(:'coach_a');
select public.save_corrective_exercise(:'ws_a', null, :'dns', 'under', 2::smallint, 5::smallint, null, true,
  '[{"muscle_id":"glute_medius","side":"L"},{"muscle_id":"glute_medius","side":"R"}]') as dns_c \gset
select is((select direction || '/' || default_sets || 'x' || default_reps || '/' || each_side from public.corrective_exercises where id = :'dns_c'),
  'under/2x5/true', 'the coach tags their own exercise as corrective');
select is((select count(*)::int from public.corrective_exercise_muscles where corrective_id = :'dns_c'), 2, 'with its muscles and sides');
select lives_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'over', 2::smallint, null, 30::smallint, false,
  '[{"muscle_id":"abs","side":"none"}]')$$, :'ws_a', :'builtin'), 'a built-in exercise can be tagged too (no copy)');
select lives_ok(format($$select public.save_corrective_exercise(%L, %L, %L, 'under', 3::smallint, 8::smallint, null, true,
  '[{"muscle_id":"glute_max","side":"L"}]')$$, :'ws_a', :'dns_c', :'dns'), 'editing replaces its tags');
select is((select string_agg(muscle_id || '.' || side, ',') from public.corrective_exercise_muscles where corrective_id = :'dns_c'),
  'glute_max.L', 'only the new tags remain');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false,
  '[{"muscle_id":"glute_medius","side":"L"}]')$$, :'ws_a', :'dns'), '23505', null, 'the same exercise and direction twice is refused');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false,
  '[{"muscle_id":"knee","side":"L"}]')$$, :'ws_a', :'builtin'), '23514', null, 'a joint is not a muscle group');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false,
  '[{"muscle_id":"abs","side":"L"}]')$$, :'ws_a', :'builtin'), '23514', null, 'abs has no sides');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, 5::smallint, 30::smallint, false,
  '[{"muscle_id":"calves","side":"L"}]')$$, :'ws_a', :'builtin'), '23514', null, 'reps and seconds together are refused');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false, '[]')$$,
  :'ws_a', :'builtin'), '22023', null, 'at least one muscle is needed');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false,
  '[{"muscle_id":"calves","side":"L"}]')$$, :'ws_a', :'b_own'), '42501', null, 'another workspace''s exercise cannot be tagged');
select throws_ok(format($$select public.save_corrective_exercise(%L, null, %L, 'under', 2::smallint, null, null, false,
  '[{"muscle_id":"calves","side":"L"}]')$$, :'ws_b', :'builtin'), '42501', null, 'nor can coach A write into workspace B');
reset role;

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.corrective_exercises where workspace_id = :'ws_a'), 0, 'another workspace''s coach sees none of A''s');
select is((select count(*)::int from public.corrective_exercise_muscles where workspace_id = :'ws_a'), 0, 'nor their tags');
update public.corrective_exercises set default_sets = 9 where id = :'dns_c';
delete from public.corrective_exercises where id = :'dns_c';
select throws_ok(format($$select public.save_corrective_exercise(%L, %L, %L, 'under', 9::smallint, null, null, false,
  '[{"muscle_id":"calves","side":"L"}]')$$, :'ws_a', :'dns_c', :'dns'), '42501', null, 'and cannot change one through the function');
reset role;
select is((select default_sets::int from public.corrective_exercises where id = :'dns_c'), 3, 'coach B''s update and delete changed nothing');

select tests.act_as(:'a1');
select is((select count(*)::int from public.corrective_exercises), 0, 'a client reads no corrective exercises');
select throws_ok(format($$insert into public.corrective_exercises (workspace_id, exercise_id, direction) values (%L, %L, 'over')$$,
  :'ws_a', :'builtin'), '42501', null, 'nor adds one');
reset role;

-- ---------- Marks, checks and picks on a draft ----------
select tests.act_as(:'coach_a');
select public.start_assessment(:'ws_a', :'a1', 'initial', false, current_date, null, null, '', array['overhead_squat']) as init_a1 \gset
select lives_ok(format($$select public.save_assessment_review(%L,
  '[{"muscle_id":"glute_medius","side":"L","status":"under","review":"confirmed","sources":["ohs.knee_valgus"]},
    {"muscle_id":"tfl","side":"R","status":"over","review":"rejected","sources":["ohs.knee_valgus"]},
    {"muscle_id":"abs","side":"none","status":"normal","review":"confirmed","sources":[]}]',
  '["ankle_mobility"]')$$, :'init_a1'), 'the coach saves marks and checks on a draft');
select is((select string_agg(muscle_id || '.' || side || '=' || status || '/' || review, ',' order by muscle_id) from public.assessment_muscle_marks where assessment_id = :'init_a1'),
  'abs.none=normal/confirmed,glute_medius.L=under/confirmed,tfl.R=over/rejected', 'marks are stored');
select is((select sources from public.assessment_muscle_marks where assessment_id = :'init_a1' and muscle_id = 'glute_medius'),
  array['ohs.knee_valgus'], 'with the checkpoints they came from');
select lives_ok(format($$select public.save_assessment_review(%L,
  '[{"muscle_id":"calves","side":"L","status":"over","review":"confirmed","sources":[]}]', '[]')$$, :'init_a1'),
  'saving again (autosave) replaces them');
select is((select count(*)::int from public.assessment_muscle_marks where assessment_id = :'init_a1'), 1, 'only the new marks remain');
select is((select count(*)::int from public.assessment_checks where assessment_id = :'init_a1'), 0, 'and the checks were replaced');
select throws_ok(format($$select public.save_assessment_review(%L,
  '[{"muscle_id":"calves","side":"L","status":"tight","review":"confirmed","sources":[]}]', '[]')$$, :'init_a1'),
  '23514', null, 'an unknown status is refused');
select throws_ok(format($$select public.save_assessment_review(%L,
  '[{"muscle_id":"calves","side":"L","status":"over","review":"confirmed","sources":["drop table"]}]', '[]')$$, :'init_a1'),
  '23514', null, 'a source that is not a checkpoint id is refused');
select throws_ok(format($$select public.save_assessment_review(%L, '[]', '["nope"]')$$, :'init_a1'),
  '23514', null, 'an unknown check is refused');
select lives_ok(format($$select public.save_assessment_picks(%L,
  '[{"muscle_id":"calves","status":"over","exercise_id":"%s"},{"muscle_id":"calves","status":"over","exercise_id":"%s"}]')$$,
  :'init_a1', :'dns', :'builtin'), 'the coach saves picks (own and built-in exercises)');
select is((select string_agg(exercise_id::text, ',' order by position) from public.assessment_exercise_picks where assessment_id = :'init_a1'),
  :'dns' || ',' || :'builtin', 'picks keep their order');
select throws_ok(format($$select public.save_assessment_picks(%L, '[{"muscle_id":"calves","status":"over","exercise_id":"%s"}]')$$,
  :'init_a1', :'b_own'), '42501', null, 'another workspace''s exercise cannot be picked');
select throws_ok(format($$select public.save_assessment_picks(%L, '[{"muscle_id":"calves","status":"normal","exercise_id":"%s"}]')$$,
  :'init_a1', :'dns'), '23514', null, 'a pick is for an over or under muscle only');
reset role;

-- Another workspace's coach and the clients: nothing.
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.assessment_muscle_marks where workspace_id = :'ws_a')
  + (select count(*)::int from public.assessment_exercise_picks where workspace_id = :'ws_a')
  + (select count(*)::int from public.assessment_checks where workspace_id = :'ws_a'), 0, 'coach B reads none of A''s marks, picks or checks');
select throws_ok(format($$select public.save_assessment_review(%L, '[]', '[]')$$, :'init_a1'), '42501', null, 'coach B cannot save A''s findings');
select throws_ok(format($$select public.save_assessment_picks(%L, '[]')$$, :'init_a1'), '42501', null, 'nor A''s picks');
select throws_ok(format($$insert into public.assessment_muscle_marks (assessment_id, workspace_id, muscle_id, side, status, review)
  values (%L, %L, 'calves', 'R', 'over', 'confirmed')$$, :'init_a1', :'ws_a'), '42501', null, 'nor insert a mark directly');
delete from public.assessment_muscle_marks where assessment_id = :'init_a1';
delete from public.assessment_exercise_picks where assessment_id = :'init_a1';
reset role;
select is((select count(*)::int from public.assessment_muscle_marks where assessment_id = :'init_a1')
  + (select count(*)::int from public.assessment_exercise_picks where assessment_id = :'init_a1'), 3, 'coach B''s deletes changed nothing');

select tests.act_as(:'a1');
select is((select count(*)::int from public.assessment_muscle_marks) + (select count(*)::int from public.assessment_exercise_picks)
  + (select count(*)::int from public.assessment_checks), 0, 'the client reads none of their own marks, picks or checks');
select throws_ok(format($$select public.save_assessment_review(%L, '[]', '[]')$$, :'init_a1'), '42501', null, 'nor saves findings');
select throws_ok(format($$select public.save_assessment_picks(%L, '[]')$$, :'init_a1'), '42501', null, 'nor picks');
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.assessment_muscle_marks), 0, 'a client of another workspace reads nothing');
reset role;

-- ---------- Finished = findings locked; picks stay the coach's plan ----------
select tests.act_as(:'coach_a');
select public.finish_assessment(:'init_a1', '[]', null);
select throws_ok(format($$select public.save_assessment_review(%L, '[]', '[]')$$, :'init_a1'), '42501', null, 'a finished assessment''s findings are locked');
select throws_ok(format($$insert into public.assessment_muscle_marks (assessment_id, workspace_id, muscle_id, side, status, review)
  values (%L, %L, 'calves', 'R', 'over', 'confirmed')$$, :'init_a1', :'ws_a'), '42501', null, 'also straight to the table');
delete from public.assessment_muscle_marks where assessment_id = :'init_a1';
select is((select count(*)::int from public.assessment_muscle_marks where assessment_id = :'init_a1'), 1, 'and its marks cannot be deleted');
select lives_ok(format($$select public.save_assessment_picks(%L, '[{"muscle_id":"calves","status":"over","exercise_id":"%s"}]')$$,
  :'init_a1', :'dns'), 'picks can still change after finishing (to remake the workout)');
reset role;

-- ---------- A removed client: readable, nothing new written ----------
select tests.act_as(:'coach_a');
select public.start_assessment(:'ws_a', :'a2', 'initial', false, current_date, null, null, '', array['push_up']) as init_a2 \gset
select public.save_assessment_review(:'init_a2', '[{"muscle_id":"chest","side":"L","status":"over","review":"confirmed","sources":[]}]', '[]');
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a2';
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.assessment_muscle_marks where assessment_id = :'init_a2'), 1, 'the coach still reads a removed client''s marks');
select throws_ok(format($$select public.save_assessment_review(%L, '[]', '[]')$$, :'init_a2'), '42501', null, 'but cannot change them');
select throws_ok(format($$select public.save_assessment_picks(%L, '[{"muscle_id":"chest","status":"over","exercise_id":"%s"}]')$$,
  :'init_a2', :'dns'), '42501', null, 'nor pick exercises for them');
reset role;

-- ---------- Photos for a coach's own exercise ----------
select is((select public::text || '/' || file_size_limit::text || '/' || array_to_string(allowed_mime_types, ',')
  from storage.buckets where id = 'exercise-images'), 'true/5242880/image/webp,image/jpeg',
  'exercise-images stays public but takes only WebP or JPEG, at most 5 MB');
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('exercise-images', 'custom/%s/%s/%s.webp', %L)$$,
  :'ws_a', :'dns', gen_random_uuid(), :'coach_a'), 'the coach uploads a photo for their own exercise');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('exercise-images', 'custom/%s/%s/%s.webp', %L)$$,
  :'ws_a', :'builtin', gen_random_uuid(), :'coach_a'), '42501', null, 'not for a built-in exercise');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('exercise-images', 'custom/%s/%s/%s.webp', %L)$$,
  :'ws_b', :'b_own', gen_random_uuid(), :'coach_a'), '42501', null, 'not into another workspace');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('exercise-images', 'free-exercise-db/x/%s.webp', %L)$$,
  gen_random_uuid(), :'coach_a'), '42501', null, 'and not outside the custom folder (built-in images stay service-role only)');
reset role;
select tests.act_as(:'a1');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('exercise-images', 'custom/%s/%s/%s.webp', %L)$$,
  :'ws_a', :'dns', gen_random_uuid(), :'a1'), '42501', null, 'a client cannot upload exercise photos');
reset role;

select * from finish();
rollback;
