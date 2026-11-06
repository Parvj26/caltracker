begin;
select plan(59);

-- Fixtures (as postgres)
select tests.create_user('bs-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('bs-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('bs-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('bs-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('bs-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('BS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('BS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select gen_random_uuid() as m_coach, gen_random_uuid() as m_client, gen_random_uuid() as m_b1 \gset
select gen_random_uuid() as f_a1, gen_random_uuid() as f_a2, gen_random_uuid() as f_b1 \gset

-- Structure
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.custom_metrics'::regclass, 'public.body_measurements'::regclass,
    'public.body_measurement_values'::regclass)), 'RLS is enabled on all three tables');
select is((select public from storage.buckets where id = 'scan-attachments'), false, 'scan-attachments bucket is private');
select ok(not has_table_privilege('authenticated', 'public.body_measurement_values', 'insert')
  and not has_table_privilege('authenticated', 'public.body_measurements', 'insert')
  and not has_table_privilege('authenticated', 'public.body_measurements', 'update')
  and not has_table_privilege('anon', 'public.body_measurements', 'select'),
  'nobody writes the measurement tables directly; anon reads nothing');

-- Coach A: custom metric, a scan with a printout
select tests.act_as(:'coach_a');
select lives_ok(
  format($$insert into public.custom_metrics (workspace_id, name, unit_label, min, max) values (%L, 'Waist', 'in', 15, 80)$$, :'ws_a'),
  'coach creates a custom metric');
select id as cm_waist from public.custom_metrics where workspace_id = :'ws_a' and name = 'Waist' \gset
select throws_ok(
  format($$insert into public.custom_metrics (workspace_id, name, min, max) values (%L, 'Bad', 10, 5)$$, :'ws_a'),
  '23514', null, 'a custom metric needs min below max');
select throws_ok(
  format($$insert into public.custom_metrics (workspace_id, name, min, max) values (%L, 'Nope', 1, 5)$$, :'ws_b'),
  '42501', null, 'coach cannot create a custom metric in another workspace');
select is(public.save_body_measurement(jsonb_build_object('id', :'m_coach', 'workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-06', 'attachment_path', :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf',
  'values', jsonb_build_object('weight_kg', 80, 'body_fat_pct', 19.6, 'custom:' || :'cm_waist', 34))),
  :'m_coach'::uuid, 'coach saves a scan');
select is((select count(*)::int from public.body_measurement_values where measurement_id = :'m_coach'), 3, 'the scan has three values');
select is((select source from public.body_measurements where id = :'m_coach'), 'coach', 'coach scan has source coach');
select is((select entered_by from public.body_measurements where id = :'m_coach'), :'coach_a'::uuid, 'entered_by is the coach');

-- Coach edit replaces values and keeps the attachment when the key is omitted
select lives_ok(format($$select public.save_body_measurement(jsonb_build_object('id', %L, 'workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-07', 'values', jsonb_build_object('weight_kg', 79.5, 'bmi', 24)))$$, :'m_coach', :'ws_a', :'a1'),
  'coach edits the scan');
select is((select string_agg(metric_key, ',' order by metric_key) from public.body_measurement_values where measurement_id = :'m_coach'),
  'bmi,weight_kg', 'edit removes values that were left out');
select is((select measured_on from public.body_measurements where id = :'m_coach'), '2026-10-07'::date, 'edit changes the date');
select ok((select attachment_path is not null from public.body_measurements where id = :'m_coach'), 'edit keeps the printout when the key is omitted');

-- Range checks (23514)
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('body_fat_pct', 80)))$$, :'ws_a', :'a1'),
  '23514', null, 'body fat above 75 is refused');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('weight_kg', 19.9)))$$, :'ws_a', :'a1'),
  '23514', null, 'weight below 20 is refused');
select lives_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('visceral_fat', 20, 'bmr_kcal', 500)))$$, :'ws_a', :'a1'),
  'range limits are inclusive');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('custom:' || %L, 81)))$$, :'ws_a', :'a1', :'cm_waist'),
  '23514', null, 'a custom value above its own max is refused');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('shoe_size', 10)))$$, :'ws_a', :'a1'),
  '23514', null, 'an unknown measure is refused');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('weight_kg', 'heavy')))$$, :'ws_a', :'a1'),
  '23514', null, 'a non-number value is refused');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', '{}'::jsonb))$$, :'ws_a', :'a1'),
  '23514', null, 'at least one value is required');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', (current_date + 3)::text, 'values', jsonb_build_object('weight_kg', 80)))$$, :'ws_a', :'a1'),
  '23514', null, 'a future date is refused');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('custom:' || gen_random_uuid(), 5)))$$, :'ws_a', :'a1'),
  '23514', null, 'a custom measure that does not exist is refused');

-- Another workspace's client, and a wrong-workspace attachment path
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('weight_kg', 80)))$$, :'ws_a', :'b1'),
  '42501', null, 'coach cannot save for a client of another workspace');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'attachment_path', %L, 'values', jsonb_build_object('weight_kg', 80)))$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a2' || '/' || :'f_a2' || '.pdf'),
  '23514', null, 'a printout under another client is refused');
reset role;

-- Coach B's scan for B1 (for the cross-workspace checks)
select tests.act_as(:'coach_b');
select public.save_body_measurement(jsonb_build_object('id', :'m_b1', 'workspace_id', :'ws_b', 'client_id', :'b1',
  'measured_on', '2026-10-06', 'values', jsonb_build_object('weight_kg', 70)));
reset role;

-- Client A1
select tests.act_as(:'a1');
select is((select count(*)::int from public.body_measurements), 2, 'client A1 sees their own two scans');
select is((select count(*)::int from public.body_measurement_values), 4, 'client A1 sees the values of their own scans');
select is((select count(*)::int from public.custom_metrics), 1, 'client A1 reads the workspace custom metrics');
select is(public.save_body_measurement(jsonb_build_object('id', :'m_client', 'workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79))),
  :'m_client'::uuid, 'client logs their weight');
select is((select source from public.body_measurements where id = :'m_client'), 'client', 'client entry has source client');
select lives_ok(format($$select public.save_body_measurement(jsonb_build_object('id', %L, 'workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 78.5)))$$, :'m_client', :'ws_a', :'a1'),
  'client edits their own weight entry');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79, 'body_fat_pct', 20)))$$, :'ws_a', :'a1'),
  '42501', null, 'client cannot log body fat');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('body_fat_pct', 20)))$$, :'ws_a', :'a1'),
  '42501', null, 'client cannot log only body fat');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 5)))$$, :'ws_a', :'a1'),
  '23514', null, 'client weight is range checked');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'attachment_path', %L, 'values', jsonb_build_object('weight_kg', 79)))$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf'),
  '42501', null, 'client cannot attach a printout');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('id', %L, 'workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-07', 'values', jsonb_build_object('weight_kg', 60)))$$, :'m_coach', :'ws_a', :'a1'),
  '42501', null, 'client cannot edit a coach scan');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79)))$$, :'ws_a', :'a2'),
  '42501', null, 'client cannot log for another client');
delete from public.body_measurements where id = :'m_coach';
select is((select count(*)::int from public.body_measurements where id = :'m_coach'), 1, 'client cannot delete a coach scan');
delete from public.body_measurements where id = :'m_client';
select is((select count(*)::int from public.body_measurements where id = :'m_client'), 0, 'client deletes their own weight entry');
reset role;

-- A coach adds another value to a client's entry: the client can no longer edit or delete it
select tests.act_as(:'a1');
select public.save_body_measurement(jsonb_build_object('id', :'m_client', 'workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79)));
reset role;
select tests.act_as(:'coach_a');
select public.save_body_measurement(jsonb_build_object('id', :'m_client', 'workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79, 'body_fat_pct', 20)));
reset role;
select tests.act_as(:'a1');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('id', %L, 'workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 70)))$$, :'m_client', :'ws_a', :'a1'),
  '42501', null, 'client cannot edit an entry the coach added to');
delete from public.body_measurements where id = :'m_client';
select is((select count(*)::int from public.body_measurements where id = :'m_client'), 1, 'client cannot delete an entry the coach added to');
reset role;

-- Client A2 and cross-workspace reads
select tests.act_as(:'a2');
select is((select count(*)::int from public.body_measurements), 0, 'client A2 sees none of A1''s measurements');
select is((select count(*)::int from public.body_measurement_values), 0, 'client A2 sees none of A1''s values');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.body_measurements where workspace_id = :'ws_a'), 0, 'coach B sees nothing of workspace A');
select is((select count(*)::int from public.custom_metrics where workspace_id = :'ws_a'), 0, 'coach B sees no custom metrics of workspace A');
delete from public.body_measurements where id = :'m_coach';
reset role;
select is((select count(*)::int from public.body_measurements where id = :'m_coach'), 1, 'coach B cannot delete workspace A scans');
select tests.act_as_anon();
select throws_ok($$select * from public.body_measurements$$, '42501', null, 'anon cannot read measurements');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-09', 'values', jsonb_build_object('weight_kg', 79)))$$, :'ws_a', :'a1'),
  '42501', null, 'anon cannot call save_body_measurement');
reset role;

-- Archived metric: history stays readable and re-savable; no new values
select tests.act_as(:'coach_a');
select public.save_body_measurement(jsonb_build_object('id', :'m_coach', 'workspace_id', :'ws_a', 'client_id', :'a1',
  'measured_on', '2026-10-07', 'values', jsonb_build_object('weight_kg', 79.5, 'custom:' || :'cm_waist', 34)));
update public.custom_metrics set archived_at = now() where id = :'cm_waist';
select is((select value from public.body_measurement_values where measurement_id = :'m_coach' and metric_key = 'custom:' || :'cm_waist'),
  34::numeric, 'an archived metric''s value stays readable');
select lives_ok(format($$select public.save_body_measurement(jsonb_build_object('id', %L, 'workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-07', 'values', jsonb_build_object('weight_kg', 79, 'custom:' || %L, 33)))$$,
  :'m_coach', :'ws_a', :'a1', :'cm_waist'), 'an old scan with an archived metric can still be edited');
select throws_ok(format($$select public.save_body_measurement(jsonb_build_object('workspace_id', %L, 'client_id', %L,
  'measured_on', '2026-10-08', 'values', jsonb_build_object('custom:' || %L, 33)))$$, :'ws_a', :'a1', :'cm_waist'),
  '23514', null, 'a new scan cannot use an archived metric');

-- Coach deletes a scan; values go with it
delete from public.body_measurements where id = :'m_coach';
select is((select count(*)::int from public.body_measurements m where m.id = :'m_coach')
  + (select count(*)::int from public.body_measurement_values where measurement_id = :'m_coach'), 0, 'coach deletes a scan and its values');
reset role;

-- Storage: coach writes, coach and that client read
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('scan-attachments', %L, %L)$$,
  :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf', :'coach_a'), 'coach uploads a printout for their client');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('scan-attachments', %L, %L)$$,
  :'ws_b' || '/' || :'b1' || '/' || :'f_b1' || '.pdf', :'coach_a'), '42501', null, 'coach cannot upload into another workspace');
reset role;
insert into storage.objects (bucket_id, name) values ('scan-attachments', :'ws_a' || '/' || :'a2' || '/' || :'f_a2' || '.pdf'),
  ('scan-attachments', :'ws_b' || '/' || :'b1' || '/' || :'f_b1' || '.pdf');
select tests.act_as(:'a1');
select is((select count(*)::int from storage.objects where bucket_id = 'scan-attachments'), 1, 'client reads only their own printouts');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('scan-attachments', %L, %L)$$,
  :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.pdf', :'a1'), '42501', null, 'client cannot upload a printout');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from storage.objects where bucket_id = 'scan-attachments'), 1, 'coach B sees only workspace B printouts');
reset role;
select tests.act_as(:'coach_a');
select is((select count(*)::int from storage.objects where bucket_id = 'scan-attachments'), 2, 'coach A sees both printouts of workspace A');
reset role;

-- Deleting a workspace removes its measurements, metrics and printouts
delete from public.workspaces where id = :'ws_a';
select is((select count(*)::int from public.body_measurements where workspace_id = :'ws_a')
  + (select count(*)::int from public.custom_metrics where workspace_id = :'ws_a')
  + (select count(*)::int from storage.objects where bucket_id = 'scan-attachments' and name like :'ws_a' || '/%'),
  0, 'deleting a workspace removes its scans, custom measures and printouts');

select * from finish();
rollback;
