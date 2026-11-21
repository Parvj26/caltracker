begin;
select plan(27);

-- Fixtures (as postgres): workspace A with client a1, workspace B with coach B.
select tests.create_user('at-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('at-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('at-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_workspace('AT Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('AT Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');

-- A retired built-in test, as a library change would leave one.
insert into public.assessment_test_definitions (test_key, version, name, kind, definition, retired_at)
values ('old_reach_test', 1, 'Old reach test', 'scored',
  '{"key":"old_reach_test","version":1,"name":"Old reach test","kind":"scored","views":[],"measures":[],"followUps":[],"steps":[],"sources":[],"summary":""}',
  now());

-- ---------- Structure ----------
select ok((select relrowsecurity from pg_class where oid = 'public.assessment_templates'::regclass), 'RLS is enabled');
select ok(not has_table_privilege('anon', 'public.assessment_templates', 'select')
  and not has_table_privilege('anon', 'public.assessment_templates', 'insert'), 'anon has no access');
select ok(not has_column_privilege('authenticated', 'public.assessment_templates', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.assessment_templates', 'id', 'insert'),
  'a template cannot be moved to another workspace');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proname = 'assessment_templates_before_write'),
  'the trigger runs as the caller (no security definer)');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'assessment_templates_before_write'),
  'the trigger pins an empty search_path');

-- ---------- The coach makes, renames, reorders and deletes templates ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys)
  values (%L, 'My lower-body screen', array['overhead_squat', 'single_leg_squat', 'side_lying_hip_hold'])$$, :'ws_a'),
  'the coach saves a set of tests as a template');
select id as tpl from public.assessment_templates where name = 'My lower-body screen' \gset
select is((select test_keys from public.assessment_templates where id = :'tpl'),
  array['overhead_squat', 'single_leg_squat', 'side_lying_hip_hold'], 'the tests keep the coach''s order');
select lives_ok(format($$update public.assessment_templates set name = 'Lower body', test_keys = array['single_leg_squat', 'overhead_squat'] where id = %L$$, :'tpl'),
  'the coach renames and reorders it');
select is((select name || ':' || array_to_string(test_keys, ',') from public.assessment_templates where id = :'tpl'),
  'Lower body:single_leg_squat,overhead_squat', 'the change is kept');
select ok((select updated_at >= created_at from public.assessment_templates where id = :'tpl'), 'updated_at moves');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'lower BODY', array['push_up'])$$, :'ws_a'),
  '23505', null, 'two templates cannot share a name (any case)');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Empty', array[]::text[])$$, :'ws_a'),
  '23514', null, 'a template needs at least one test');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Twice', array['push_up', 'push_up'])$$, :'ws_a'),
  '22023', null, 'a test cannot be in a template twice');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Made up', array['not_a_test'])$$, :'ws_a'),
  '22023', null, 'a test that is not in the library is refused');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, ' Spaces ', array['push_up'])$$, :'ws_a'),
  '23514', null, 'the name is stored trimmed');
select lives_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Old one', array['old_reach_test', 'push_up'])$$, :'ws_a'),
  'a retired test may stay in a template (the website leaves it out when used)');
select lives_ok(format($$select public.start_assessment(%L, %L, 'initial', false, current_date, null, null, '',
    (select array_remove(test_keys, 'old_reach_test') from public.assessment_templates where name = 'Old one'))$$, :'ws_a', :'a1'),
  'an assessment starts from a template''s tests that are still offered');
select is((select array_agg(t.test_key order by t.position) from public.assessment_tests t join public.assessments a on a.id = t.assessment_id
    where a.client_id = :'a1'), array['push_up'], 'with the template''s tests');
select throws_ok(format($$select public.start_assessment(%L, %L, 'retest_1', false, current_date, null, null, '', array['old_reach_test'])$$, :'ws_a', :'a1'),
  null, null, 'a retired test itself can''t be started');

-- ---------- Nobody else ----------
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.assessment_templates), 0, 'another workspace''s coach sees no templates');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Sneaky', array['push_up'])$$, :'ws_a'),
  '42501', null, 'another workspace''s coach cannot add one to workspace A');
update public.assessment_templates set name = 'Hijacked' where id = :'tpl';
delete from public.assessment_templates where id = :'tpl';
select tests.act_as(:'a1');
select is((select count(*)::int from public.assessment_templates), 0, 'a client sees no templates');
select throws_ok(format($$insert into public.assessment_templates (workspace_id, name, test_keys) values (%L, 'Mine', array['push_up'])$$, :'ws_a'),
  '42501', null, 'a client cannot add a template');
update public.assessment_templates set name = 'Client edit' where id = :'tpl';
delete from public.assessment_templates where id = :'tpl';
select tests.act_as_anon();
select throws_ok($$select count(*) from public.assessment_templates$$, '42501', null, 'anon cannot read templates');
reset role;
select is((select name from public.assessment_templates where id = :'tpl'), 'Lower body',
  'the other coach''s and the client''s updates and deletes changed nothing');

-- ---------- Delete ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$delete from public.assessment_templates where id = %L$$, :'tpl'), 'the coach deletes a template');
reset role;
select is((select count(*)::int from public.assessment_templates where id = :'tpl'), 0, 'it is gone');

select * from finish();
rollback;
