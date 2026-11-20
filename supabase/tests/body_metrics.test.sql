begin;
select plan(63);

-- Metrics (migration 20261119000100_body_metrics.sql): body_metrics rows, the metric_entries view that adds the
-- InBody scan and weigh-in values from body_measurements, and the Apple Health sync.

-- Fixtures (as postgres)
select tests.create_user('bm-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('bm-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('bm-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('bm-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('bm-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('BM Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('BM Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select gen_random_uuid() as m_coach, gen_random_uuid() as m_a1, gen_random_uuid() as m_b1 \gset

-- ---------- Structure ----------
select ok((select relrowsecurity from pg_class where oid = 'public.body_metrics'::regclass), 'RLS is enabled on body_metrics');
select ok(not has_table_privilege('anon', 'public.body_metrics', 'select')
  and not has_table_privilege('anon', 'public.metric_entries', 'select')
  and not has_function_privilege('anon', 'public.sync_apple_health_metrics(uuid, jsonb)', 'execute'),
  'anon reads nothing and cannot sync');
select ok(not has_column_privilege('authenticated', 'public.body_metrics', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.body_metrics', 'source', 'update')
  and not has_column_privilege('authenticated', 'public.body_metrics', 'entered_by_role', 'update')
  and not has_column_privilege('authenticated', 'public.body_metrics', 'external_id', 'update')
  and has_column_privilege('authenticated', 'public.body_metrics', 'value', 'update'),
  'only the value and its date can be changed');
select is((select reloptions from pg_class where oid = 'public.metric_entries'::regclass), array['security_invoker=true'],
  'metric_entries runs with the caller''s rights (RLS of the tables applies)');
select is((select prosecdef from pg_proc where oid = 'public.sync_apple_health_metrics(uuid, jsonb)'::regprocedure), false,
  'the Apple Health sync is security invoker');

-- Old data the installed app wrote: an InBody scan by coach A and a weigh-in by A1 (and B1 in workspace B).
select tests.act_as(:'coach_a');
select public.save_body_measurement(jsonb_build_object('workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-01', 'values', jsonb_build_object('weight_kg', 80, 'body_fat_pct', 20, 'smm_kg', 35, 'bmi', 24)))
  as scan_a1 \gset
select public.save_body_measurement(jsonb_build_object('workspace_id', :'ws_a', 'client_id', :'a2',
  'measured_on', '2026-10-02', 'values', jsonb_build_object('weight_kg', 70))) as weigh_coach_a2 \gset
reset role;
select tests.act_as(:'a1');
select public.save_body_measurement(jsonb_build_object('workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-05', 'values', jsonb_build_object('weight_kg', 79.5))) as weigh_a1 \gset
reset role;
select tests.act_as(:'b1');
select public.save_body_measurement(jsonb_build_object('workspace_id', :'ws_b', 'client_id', :'b1',
  'measured_on', '2026-10-05', 'values', jsonb_build_object('weight_kg', 60))) as weigh_b1 \gset
reset role;

-- ---------- Coach writes ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.body_metrics (id, workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, %L, 'vo2_max', 42.5, '2026-10-10', 'manual', 'coach')$$, :'m_coach', :'ws_a', :'a1'),
  'coach logs a VO2 max for their client');
select is((select entered_by from public.body_metrics where id = :'m_coach'), :'coach_a'::uuid, 'entered_by is the coach');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 80, '2026-10-10', 'manual', 'client')$$, :'ws_a', :'a1'),
  '42501', null, 'coach cannot log an entry as if the client made it');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role, external_id) values (%L, %L, 'weight_kg', 80, '2026-10-10', 'apple_health', 'coach', 'x')$$, :'ws_a', :'a1'),
  '42501', null, 'coach cannot add Apple Health entries');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role, entered_by) values (%L, %L, 'waist_cm', 80, '2026-10-10', 'manual', 'coach', %L)$$, :'ws_a', :'a1', :'coach_b'),
  '42501', null, 'coach cannot sign an entry with someone else''s id');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 80, '2026-10-10', 'manual', 'coach')$$, :'ws_b', :'b1'),
  '42501', null, 'coach cannot log for another workspace''s client');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 80, '2026-10-10', 'manual', 'coach')$$, :'ws_a', :'b1'),
  '42501', null, 'coach cannot log for a user who is not their client');

-- Ranges, keys, dates
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'resting_hr_bpm', 221, '2026-10-10', 'manual', 'coach')$$, :'ws_a', :'a1'),
  '23514', null, 'resting heart rate above 220 is refused');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'steps', 1000, '2026-10-10', 'manual', 'coach')$$, :'ws_a', :'a1'),
  '23514', null, 'an unknown metric (steps) is refused');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 80, current_date + 5, 'manual', 'coach')$$, :'ws_a', :'a1'),
  '23514', null, 'a future date is refused');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  measured_at, source, entered_by_role) values (%L, %L, 'waist_cm', 80, current_date, now() + interval '2 days', 'manual', 'coach')$$,
  :'ws_a', :'a1'), '23514', null, 'a time more than a day ahead is refused');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  measured_at, source, entered_by_role) values (%L, %L, 'waist_cm', 80, '2026-10-01', '2026-10-05T10:00:00Z', 'manual', 'coach')$$,
  :'ws_a', :'a1'), '23514', null, 'a time far from its date is refused');
select lives_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 40, '2026-10-11', 'manual', 'coach'),
  (%L, %L, 'resting_hr_bpm', 220, '2026-10-11', 'manual', 'coach')$$, :'ws_a', :'a1', :'ws_a', :'a1'),
  'range limits are inclusive');

select lives_ok(format($$update public.body_metrics set value = 43 where id = %L$$, :'m_coach'), 'coach edits their entry');
select is((select value from public.body_metrics where id = :'m_coach'), 43::numeric, 'the edit is saved');
select throws_ok(format($$update public.body_metrics set entered_by_role = 'client' where id = %L$$, :'m_coach'),
  '42501', null, 'who entered it cannot be changed');
reset role;

-- ---------- Client writes ----------
select tests.act_as(:'a1');
select lives_ok(format($$insert into public.body_metrics (id, workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'client')$$, :'m_a1', :'ws_a', :'a1'),
  'client logs their own waist');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'coach')$$, :'ws_a', :'a1'),
  '42501', null, 'client cannot mark an entry as the coach''s');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'client')$$, :'ws_a', :'a2'),
  '42501', null, 'client cannot log for another client');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'client')$$, :'ws_b', :'a1'),
  '42501', null, 'client cannot log into a workspace they are not a client of');
select lives_ok(format($$update public.body_metrics set value = 81 where id = %L$$, :'m_a1'), 'client edits their own entry');
update public.body_metrics set value = 99 where id = :'m_coach';
delete from public.body_metrics where id = :'m_coach';
reset role;
select is((select value from public.body_metrics where id = :'m_coach'), 43::numeric,
  'client can neither change nor delete the coach''s entry');
select is((select value from public.body_metrics where id = :'m_a1'), 81::numeric, 'the client''s edit is saved');

select tests.act_as(:'coach_a');
update public.body_metrics set value = 99 where id = :'m_a1';
delete from public.body_metrics where id = :'m_a1';
reset role;
select is((select value from public.body_metrics where id = :'m_a1'), 81::numeric,
  'coach can neither change nor delete the client''s entry');

-- ---------- Reads ----------
select tests.act_as(:'b1');
insert into public.body_metrics (id, workspace_id, client_id, metric_key, value, measured_on, source, entered_by_role)
values (:'m_b1', :'ws_b', :'b1', 'weight_kg', 61, '2026-10-12', 'manual', 'client');
select is((select count(*)::int from public.body_metrics where workspace_id = :'ws_a'), 0, 'B1 reads nothing of workspace A');
select is((select count(*)::int from public.metric_entries where workspace_id = :'ws_a'), 0, 'B1 sees no workspace A entries in the view');
update public.body_metrics set value = 100 where id = :'m_a1';
delete from public.body_metrics where id = :'m_a1';
reset role;
select is((select value from public.body_metrics where id = :'m_a1'), 81::numeric, 'B1 cannot change or delete A1''s entry');

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.metric_entries where client_id = :'a1'), 0, 'coach B sees nothing of A1');
update public.body_metrics set value = 100 where id = :'m_coach';
delete from public.body_metrics where id = :'m_coach';
reset role;
select is((select value from public.body_metrics where id = :'m_coach'), 43::numeric, 'coach B cannot change or delete coach A''s entry');

select tests.act_as(:'a2');
select is((select count(*)::int from public.metric_entries where client_id <> (select auth.uid())), 0, 'A2 sees nothing of A1');
reset role;

select tests.act_as(:'a1');
select results_eq(
  $$select origin, metric_key, value, source, entered_by_role from public.metric_entries order by measured_on, metric_key, value$$,
  format($$values
    ('body_measurements'::text, 'body_fat_pct'::text, 20::numeric, 'inbody_scan'::text, 'coach'::text),
    ('body_measurements', 'smm_kg', 35, 'inbody_scan', 'coach'),
    ('body_measurements', 'weight_kg', 80, 'inbody_scan', 'coach'),
    ('body_measurements', 'weight_kg', 79.5, 'manual', 'client'),
    ('body_metrics', 'vo2_max', 43, 'manual', 'coach'),
    ('body_metrics', 'resting_hr_bpm', 220, 'manual', 'coach'),
    ('body_metrics', 'waist_cm', 40, 'manual', 'coach'),
    ('body_metrics', 'waist_cm', 81, 'manual', 'client')$$),
  'A1 sees old scan and weigh-in values (not BMI) next to the new entries, each with its source');
select is((select id from public.metric_entries where origin = 'body_measurements' and source = 'manual'), :'weigh_a1'::uuid,
  'an old weigh-in carries its body_measurements id (for editing it the old way)');
reset role;

select tests.act_as(:'coach_a');
select results_eq(format($$select source, entered_by_role from public.metric_entries where id = %L$$, :'weigh_coach_a2'),
  $$values ('manual'::text, 'coach'::text)$$, 'a coach-typed weight on its own is a manual entry by the coach, not a scan');
select is((select count(*)::int from public.metric_entries where client_id = :'a1'), 8, 'coach A sees all of A1''s entries');
reset role;

-- ---------- Apple Health sync ----------
select tests.act_as(:'a1');
select is(public.sync_apple_health_metrics(:'ws_a', jsonb_build_array(
  jsonb_build_object('external_id', 'hk-1', 'metric_key', 'weight_kg', 'value', 79.1, 'measured_on', '2026-10-20',
    'measured_at', '2026-10-20T07:00:00Z'),
  jsonb_build_object('external_id', 'hk-2', 'metric_key', 'resting_hr_bpm', 'value', 58, 'measured_on', '2026-10-20'))),
  2, 'the first sync adds two samples');
select is(public.sync_apple_health_metrics(:'ws_a', jsonb_build_array(
  jsonb_build_object('external_id', 'hk-1', 'metric_key', 'weight_kg', 'value', 79.1, 'measured_on', '2026-10-20',
    'measured_at', '2026-10-20T07:00:00Z'),
  jsonb_build_object('external_id', 'hk-2', 'metric_key', 'resting_hr_bpm', 'value', 57, 'measured_on', '2026-10-20'))),
  1, 'a re-sync changes only the sample that changed');
select is((select count(*)::int from public.body_metrics where source = 'apple_health'), 2, 're-syncing never duplicates');
select is(public.sync_apple_health_metrics(:'ws_a', jsonb_build_array(
  jsonb_build_object('external_id', 'hk-dup', 'metric_key', 'vo2_max', 'value', 40, 'measured_on', '2026-10-21'),
  jsonb_build_object('external_id', 'hk-dup', 'metric_key', 'vo2_max', 'value', 41, 'measured_on', '2026-10-21'))),
  1, 'the same sample twice in one call is saved once');
select is((select value from public.body_metrics where external_id = 'hk-dup'), 41::numeric, 'the later copy wins');
delete from public.body_metrics where external_id = 'hk-dup';
select is((select value from public.body_metrics where external_id = 'hk-2'), 57::numeric, 'the changed sample has its new value');
select is((select entered_by_role || '/' || entered_by::text from public.body_metrics where external_id = 'hk-1'),
  'client/' || :'a1', 'imports are marked as the client''s own');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, jsonb_build_array(jsonb_build_object(
  'external_id', 'hk-3', 'metric_key', 'smm_kg', 'value', 30, 'measured_on', '2026-10-20')))$$, :'ws_a'),
  '23514', null, 'Apple Health cannot bring skeletal muscle mass');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, jsonb_build_array(jsonb_build_object(
  'external_id', 'hk-3', 'metric_key', 'weight_kg', 'value', 70, 'measured_on', '2026-10-20')))$$, :'ws_b'),
  '42501', null, 'a client cannot sync into a workspace they are not a client of');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, '{}'::jsonb)$$, :'ws_a'),
  '22023', null, 'samples must be a list');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, (select jsonb_agg(jsonb_build_object(
  'external_id', 'x' || g, 'metric_key', 'weight_kg', 'value', 70, 'measured_on', '2026-10-20')) from generate_series(1, 501) g))$$, :'ws_a'),
  '22023', null, 'at most 500 samples per call');
reset role;

select tests.act_as(:'coach_a');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, jsonb_build_array(jsonb_build_object(
  'external_id', 'hk-9', 'metric_key', 'weight_kg', 'value', 70, 'measured_on', '2026-10-20')))$$, :'ws_a'),
  '42501', null, 'a coach cannot import Apple Health data');
update public.body_metrics set value = 99 where external_id = 'hk-1';
delete from public.body_metrics where external_id = 'hk-1';
reset role;
select is((select value from public.body_metrics where external_id = 'hk-1'), 79.1::numeric,
  'coach can neither change nor delete Apple Health entries');

-- Turning the import off: the client removes their imported rows.
select tests.act_as(:'a1');
with d as (delete from public.body_metrics where source = 'apple_health' returning 1)
select is(count(*)::int, 2, 'client deletes their Apple Health imports') from d;
select lives_ok(format($$delete from public.body_metrics where id = %L$$, :'m_a1'), 'client deletes their own manual entry');
reset role;
select is((select count(*)::int from public.body_metrics where id = :'m_a1'), 0, 'the entry is gone');

select tests.act_as(:'coach_a');
with d as (delete from public.body_metrics where id = :'m_coach' returning 1)
select is(count(*)::int, 1, 'coach deletes their own entry') from d;
reset role;

-- ---------- A removed client ----------
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a1';
select tests.act_as(:'a1');
select is((select count(*)::int from public.metric_entries) + (select count(*)::int from public.body_metrics), 0,
  'a removed client reads nothing');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'client')$$, :'ws_a', :'a1'),
  '42501', null, 'a removed client cannot log');
select throws_ok(format($$select public.sync_apple_health_metrics(%L, jsonb_build_array(jsonb_build_object(
  'external_id', 'hk-late', 'metric_key', 'weight_kg', 'value', 70, 'measured_on', '2026-10-20')))$$, :'ws_a'),
  '42501', null, 'a removed client cannot sync from Apple Health');
reset role;
select tests.act_as(:'coach_a');
select ok((select count(*) from public.metric_entries where client_id = :'a1') >= 1, 'the coach still reads a removed client''s history');
select throws_ok(format($$insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on,
  source, entered_by_role) values (%L, %L, 'waist_cm', 82, '2026-10-12', 'manual', 'coach')$$, :'ws_a', :'a1'),
  '42501', null, 'the coach cannot log for a removed client');
reset role;

-- ---------- Deleting an account erases the rows ----------
select is((select count(*)::int from public.body_metrics where client_id = :'b1'), 1, 'B1 has an entry');
delete from auth.users where id = :'b1';
select is((select count(*)::int from public.body_metrics where client_id = :'b1'), 0, 'deleting B1''s account deletes their metrics');

select * from finish();
rollback;
