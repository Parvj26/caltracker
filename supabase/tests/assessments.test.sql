begin;
select plan(74);

-- Fixtures (as postgres): workspace A with clients a1 and a2, workspace B with client b1.
select tests.create_user('as-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('as-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('as-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('as-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('as-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('AS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

-- ---------- Structure ----------
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.assessment_test_definitions'::regclass, 'public.assessment_cycles'::regclass,
    'public.assessments'::regclass, 'public.assessment_tests'::regclass,
    'public.assessment_checkpoint_results'::regclass, 'public.assessment_measure_results'::regclass)),
  'RLS is enabled on all six tables');
select ok(not has_table_privilege('anon', 'public.assessments', 'select')
  and not has_table_privilege('anon', 'public.assessment_tests', 'select')
  and not has_table_privilege('anon', 'public.assessment_checkpoint_results', 'select')
  and not has_table_privilege('anon', 'public.assessment_test_definitions', 'select'), 'anon has no access');
select ok(not has_column_privilege('authenticated', 'public.assessment_tests', 'definition', 'insert')
  and not has_column_privilege('authenticated', 'public.assessment_tests', 'definition', 'update')
  and not has_column_privilege('authenticated', 'public.assessment_tests', 'test_key', 'insert')
  and not has_column_privilege('authenticated', 'public.assessments', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.assessments', 'finished_at', 'update')
  and not has_column_privilege('authenticated', 'public.assessments', 'coach_id', 'insert')
  and not has_table_privilege('authenticated', 'public.assessment_test_definitions', 'insert'),
  'definition copies, owners, finish times and the library cannot be written by the app');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.proname in ('start_assessment', 'save_assessment_test', 'finish_assessment', 'assessments_before_write',
      'assessment_cycles_before_insert', 'assessment_tests_before_insert', 'assessment_write_guard',
      'assessment_write_allowed')),
  'every new function runs as the caller (no security definer)');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('start_assessment', 'save_assessment_test', 'finish_assessment')),
  'the functions pin an empty search_path');
select is((select count(*)::int from public.assessment_test_definitions where workspace_id is null), 9, 'nine built-in tests are seeded');
select ok((select position('pg_advisory_xact_lock' in p.prosrc) between 1 and position('assessment_cycles c' in p.prosrc)
  from pg_proc p where p.proname = 'start_assessment'), 'start_assessment locks the client before reading the cycles');
select ok(not has_function_privilege('anon', 'public.start_assessment(uuid, uuid, text, boolean, date, text, text, text, text[])', 'execute'),
  'anon cannot start an assessment');

-- ---------- The coach runs an Initial ----------
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.assessment_test_definitions), 9, 'the coach reads the built-in library');
select public.start_assessment(:'ws_a', :'a1', 'initial', false, current_date, 'flat', 'normal', '',
  array['overhead_squat', 'shoulder_mobility', 'static_posture']) as init_a1 \gset
select is((select count(*)::int from public.assessment_cycles where client_id = :'a1'), 1, 'the first assessment opens cycle 1');
select is((select status || '/' || slot || '/' || foot_arch_left || '/' || foot_arch_right from public.assessments where id = :'init_a1'),
  'draft/initial/flat/normal', 'it starts as a draft with the foot arch recorded');
select is((select coach_id from public.assessments where id = :'init_a1'), :'coach_a'::uuid, 'the coach is recorded');
select is((select array_agg(test_key order by position) from public.assessment_tests where assessment_id = :'init_a1'),
  array['overhead_squat', 'shoulder_mobility', 'static_posture'], 'tests are kept in the order picked');
select is((select definition ->> 'name' from public.assessment_tests where assessment_id = :'init_a1' and test_key = 'overhead_squat'),
  'Overhead squat', 'each test keeps a copy of its definition');
select id as ohs_a1 from public.assessment_tests where assessment_id = :'init_a1' and test_key = 'overhead_squat' \gset
select id as shm_a1 from public.assessment_tests where assessment_id = :'init_a1' and test_key = 'shoulder_mobility' \gset

select lives_ok(format($$select public.save_assessment_test(%L, 'done',
    '[{"checkpoint_id":"ohs.knee_valgus","side":"L","severity":"severe"},{"checkpoint_id":"ohs.forward_lean","side":"none","severity":"slight"}]',
    '[]', '{"ohs.heel_lift_retest":"better"}', true, false, '', 'Calves felt tight', 75::smallint)$$, :'ohs_a1'),
  'the coach saves a test');
select is((select count(*)::int from public.assessment_checkpoint_results where test_id = :'ohs_a1'), 2, 'ratings are stored');
select is((select note || '/' || discomfort_left::text || '/' || score::text from public.assessment_tests where id = :'ohs_a1'),
  'Calves felt tight/true/75', 'note, discomfort and score are stored');
select lives_ok(format($$select public.save_assessment_test(%L, 'done',
    '[{"checkpoint_id":"ohs.knee_valgus","side":"L","severity":"slight"}]', '[]', '{}', false, false, '', '', 90::smallint)$$, :'ohs_a1'),
  'saving again (autosave) replaces the ratings');
select is((select string_agg(severity, ',') from public.assessment_checkpoint_results where test_id = :'ohs_a1'), 'slight', 'only the new ratings remain');
select throws_ok(format($$select public.save_assessment_test(%L, 'done',
    '[{"checkpoint_id":"ohs.nope","side":"L","severity":"slight"}]', '[]', '{}', false, false, '', '', null)$$, :'ohs_a1'),
  '22023', null, 'a checkpoint the test does not have is refused');
select throws_ok(format($$select public.save_assessment_test(%L, 'done',
    '[{"checkpoint_id":"ohs.forward_lean","side":"L","severity":"slight"}]', '[]', '{}', false, false, '', '', null)$$, :'ohs_a1'),
  '22023', null, 'a side that does not fit the checkpoint is refused');
select throws_ok(format($$select public.save_assessment_test(%L, 'done',
    '[{"checkpoint_id":"shm.shoulder_hike","side":"L","severity":"slight"}]', '[]', '{}', false, false, '', '', null)$$, :'ohs_a1'),
  '22023', null, 'another test''s checkpoint is refused');
select lives_ok(format($$select public.save_assessment_test(%L, 'done', '[]',
    '[{"measure_id":"shm.reach_gap","side":"L","value":14},{"measure_id":"shm.reach_gap","side":"R","value":11}]',
    '{}', false, false, '', '', 100::smallint)$$, :'shm_a1'), 'the coach saves measurements');
select is((select string_agg(side || '=' || value::text || unit || '/' || higher_is_better::text, ',' order by side)
  from public.assessment_measure_results where test_id = :'shm_a1'), 'L=14cm/false,R=11cm/false',
  'measurements take their unit and direction from the definition');
select throws_ok(format($$select public.save_assessment_test(%L, 'done', '[]',
    '[{"measure_id":"shm.reach_gap","side":"L","value":61}]', '{}', false, false, '', '', null)$$, :'shm_a1'),
  '22023', null, 'a number outside the measure''s range is refused');
-- Straight to the tables (the REST API), the same writes are refused: only the functions, which check them, may.
select throws_ok(format($$insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
  values (%L, %L, 'ohs.nope', 'L', 'severe')$$, :'ohs_a1', :'ws_a'), '42501', null, 'the coach cannot add a rating directly');
select throws_ok(format($$insert into public.assessment_measure_results (test_id, workspace_id, measure_id, side, value, unit, higher_is_better)
  values (%L, %L, 'shm.reach_gap', 'L', 3, 'deg', true)$$, :'shm_a1', :'ws_a'), '42501', null, 'nor a number with its own unit and direction');
select throws_ok(format($$delete from public.assessment_checkpoint_results where test_id = %L$$, :'ohs_a1'),
  '42501', null, 'nor delete ratings directly');
select throws_ok(format($$delete from public.assessment_measure_results where test_id = %L$$, :'shm_a1'),
  '42501', null, 'nor delete numbers directly');
select throws_ok(format($$update public.assessment_tests set score = 100 where id = %L$$, :'ohs_a1'),
  '42501', null, 'nor set a test''s score directly');
select throws_ok(format($$update public.assessment_tests set status = 'skipped' where id = %L$$, :'ohs_a1'),
  '42501', null, 'nor a test''s status');
select throws_ok(format($$update public.assessments set status = 'done', score = 100 where id = %L$$, :'init_a1'),
  '42501', null, 'nor finish an assessment directly with a score of their choosing');
select lives_ok(format($$update public.assessments set note = 'Shoes: trainers' where id = %L$$, :'init_a1'),
  'a draft''s note can still be changed');
select throws_ok(format($$insert into public.assessment_tests (workspace_id, assessment_id, position, definition_id, definition)
  values (%L, %L, 9, (select id from public.assessment_test_definitions where test_key = 'push_up'), '{}')$$, :'ws_a', :'init_a1'),
  '42501', null, 'the app cannot send its own definition copy');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', false, current_date, null, null, '', array['no_such_test'])$$,
  :'ws_a', :'a2'), '22023', null, 'an unknown test is refused');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', false, current_date, null, null, '', array['push_up', 'push_up'])$$,
  :'ws_a', :'a2'), '22023', null, 'the same test twice is refused');

-- Order: no Retest 1 before the Initial is done; no new cycle before Retest 1 is done.
select throws_ok(format($$select public.start_assessment(%L, %L, 'retest_1', false, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '23514', null, 'Retest 1 waits for a done Initial');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', true, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '23514', null, 'a new cycle waits for Retest 1');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', false, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '23505', null, 'a cycle has one Initial');
reset role;

-- ---------- Nobody else reads or writes it ----------
select tests.act_as(:'a1');
select is((select count(*)::int from public.assessment_cycles) + (select count(*)::int from public.assessments)
  + (select count(*)::int from public.assessment_tests) + (select count(*)::int from public.assessment_checkpoint_results)
  + (select count(*)::int from public.assessment_measure_results), 0, 'the client cannot read their own assessment');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', true, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '42501', null, 'the client cannot start one');
select throws_ok(format($$select public.save_assessment_test(%L, 'done', '[]', '[]', '{}', false, false, '', 'mine', null)$$, :'ohs_a1'),
  '42501', null, 'the client cannot save a test');
select throws_ok(format($$insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
  values (%L, %L, 'ohs.knee_varus', 'L', 'severe')$$, :'ohs_a1', :'ws_a'), '42501', null, 'the client cannot add ratings');
reset role;

select tests.act_as(:'a2');
select is((select count(*)::int from public.assessments) + (select count(*)::int from public.assessment_tests), 0,
  'another client of the workspace reads nothing');
reset role;

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.assessment_cycles) + (select count(*)::int from public.assessments)
  + (select count(*)::int from public.assessment_tests) + (select count(*)::int from public.assessment_checkpoint_results)
  + (select count(*)::int from public.assessment_measure_results), 0, 'another workspace''s coach reads nothing');
select is((select count(*)::int from public.assessment_test_definitions), 9, 'another coach still reads the built-in library');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', true, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '42501', null, 'another workspace''s coach cannot start one for the client');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', true, current_date, null, null, '', array['push_up'])$$,
  :'ws_b', :'a1'), '42501', null, 'nor file one under their own workspace for someone else''s client');
select throws_ok(format($$select public.save_assessment_test(%L, 'done', '[]', '[]', '{}', false, false, '', 'hacked', null)$$, :'ohs_a1'),
  '42501', null, 'another workspace''s coach cannot save the test');
select throws_ok(format($$insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
  values (%L, %L, 'ohs.knee_varus', 'L', 'severe')$$, :'ohs_a1', :'ws_a'), '42501', null, 'nor add ratings to it');
select throws_ok(format($$insert into public.assessment_checkpoint_results (test_id, workspace_id, checkpoint_id, side, severity)
  values (%L, %L, 'ohs.knee_varus', 'L', 'severe')$$, :'ohs_a1', :'ws_b'), '42501', null, 'nor under their own workspace id');
select throws_ok(format($$select public.finish_assessment(%L, '[]', 10::smallint)$$, :'init_a1'),
  '42501', null, 'nor finish it');
update public.assessments set note = 'hacked';
update public.assessment_tests set note = 'hacked';
delete from public.assessment_checkpoint_results;
delete from public.assessments;
reset role;
select is((select note from public.assessment_tests where id = :'ohs_a1'), '', 'the other coach changed nothing');
select is((select count(*)::int from public.assessment_checkpoint_results where test_id = :'ohs_a1'), 1, 'and deleted nothing');
select is((select count(*)::int from public.assessments where id = :'init_a1'), 1, 'the assessment is still there');

select tests.act_as_anon();
select throws_ok('select * from public.assessments', '42501', null, 'anon cannot read assessments');
reset role;

-- ---------- Finish, then retests and a new cycle ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$select public.finish_assessment(%L, %L::jsonb, 83::smallint)$$, :'init_a1',
  json_build_array(json_build_object('test_id', :'ohs_a1', 'score', 90), json_build_object('test_id', :'shm_a1', 'score', 100))),
  'the coach finishes the Initial');
select is((select status || '/' || score::text || '/' || (finished_at is not null)::text from public.assessments where id = :'init_a1'),
  'done/83/true', 'it is done with its score and finish time');
select is((select status from public.assessment_tests where assessment_id = :'init_a1' and test_key = 'static_posture'),
  'skipped', 'a test never reached counts as skipped');
select throws_ok(format($$select public.save_assessment_test(%L, 'done', '[]', '[]', '{}', false, false, '', 'later', null)$$, :'ohs_a1'),
  '42501', null, 'a finished assessment''s tests cannot change');
update public.assessments set note = 'later' where id = :'init_a1';
select is((select note from public.assessments where id = :'init_a1'), 'Shoes: trainers', 'nor the assessment itself');
delete from public.assessments where id = :'init_a1';
select is((select count(*)::int from public.assessments where id = :'init_a1'), 1, 'a finished assessment cannot be deleted');

select public.start_assessment(:'ws_a', :'a1', 'retest_1', false, current_date, 'flat', 'normal', '',
  array['overhead_squat', 'shoulder_mobility']) as r1_a1 \gset
select is((select cycle_id from public.assessments where id = :'r1_a1'), (select cycle_id from public.assessments where id = :'init_a1'),
  'Retest 1 goes in the same cycle');
select throws_ok(format($$select public.start_assessment(%L, %L, 'retest_2', false, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '23514', null, 'Retest 2 waits for a done Retest 1');
select lives_ok(format($$select public.finish_assessment(%L, '[]', null)$$, :'r1_a1'), 'Retest 1 is finished');
select public.start_assessment(:'ws_a', :'a1', 'initial', true, current_date, null, null, '', array['push_up']) as c2_a1 \gset
select is((select c.number from public.assessments a join public.assessment_cycles c on c.id = a.cycle_id where a.id = :'c2_a1'), 2,
  'a new cycle is cycle 2');
select throws_ok(format($$select public.start_assessment(%L, %L, 'retest_2', false, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a1'), '23514', null, 'an older cycle takes no more assessments');
select id as pu_c2 from public.assessment_tests where assessment_id = :'c2_a1' \gset
select public.save_assessment_test(:'pu_c2', 'done', '[{"checkpoint_id":"pu.lumbar_sag","side":"none","severity":"slight"}]',
  '[]', '{}', false, false, 'Floor', '', 50::smallint);
select lives_ok(format($$delete from public.assessments where id = %L$$, :'c2_a1'), 'a draft can be deleted');
select is((select count(*)::int from public.assessments where id = :'c2_a1')
  + (select count(*)::int from public.assessment_checkpoint_results where test_id = :'pu_c2'), 0,
  'the draft is gone, with its ratings');
select throws_ok(format($$insert into public.assessment_cycles (workspace_id, client_id, number) values (%L, %L, 5)$$, :'ws_a', :'a1'),
  '23514', null, 'cycles are numbered one after another');
reset role;

-- ---------- A removed client: history stays readable, nothing new is written ----------
select tests.act_as(:'coach_a');
select public.start_assessment(:'ws_a', :'a2', 'initial', false, current_date, null, null, '', array['push_up']) as init_a2 \gset
select id as pu_a2 from public.assessment_tests where assessment_id = :'init_a2' \gset
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a2';
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.assessments where client_id = :'a2'), 1, 'the coach still reads a removed client''s assessment');
select throws_ok(format($$select public.save_assessment_test(%L, 'done', '[]', '[]', '{}', false, false, 'Floor', '', null)$$, :'pu_a2'),
  '42501', null, 'but cannot save into it');
select throws_ok(format($$select public.start_assessment(%L, %L, 'initial', true, current_date, null, null, '', array['push_up'])$$,
  :'ws_a', :'a2'), '42501', null, 'nor start a new one');
delete from public.assessments where id = :'init_a2';
select is((select count(*)::int from public.assessments where id = :'init_a2'), 1, 'nor delete the removed client''s draft');
reset role;

select * from finish();
rollback;
