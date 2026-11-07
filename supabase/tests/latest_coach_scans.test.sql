begin;
select plan(6);

select tests.create_user('lcs-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('lcs-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('lcs-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('lcs-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('lcs-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('LCS Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('LCS Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

-- As postgres: a1 has two coach scans and a newer weigh-in of their own; a2 has none; b1 has one.
insert into public.body_measurements (workspace_id, client_id, measured_on, source) values
  (:'ws_a', :'a1', '2026-09-01', 'coach'),
  (:'ws_a', :'a1', '2026-10-01', 'coach'),
  (:'ws_a', :'a1', '2026-11-01', 'client'),
  (:'ws_b', :'b1', '2026-10-15', 'coach');

select tests.act_as(:'coach_a');
select results_eq(format($$select client_id, measured_on from public.latest_coach_scans(%L)$$, :'ws_a'),
  format($$values (%L::uuid, '2026-10-01'::date)$$, :'a1'),
  'the coach gets each client''s latest coach scan (a client''s own weigh-in does not count)');
select is((select count(*)::int from public.latest_coach_scans(:'ws_b')), 0, 'nothing from another workspace');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.latest_coach_scans(:'ws_a')), 0, 'another workspace''s coach gets nothing');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.latest_coach_scans(:'ws_a')), 1, 'a client gets at most their own row');
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from public.latest_coach_scans(:'ws_a')), 0, 'another client of the workspace gets nothing');
reset role;
select tests.act_as_anon();
select throws_ok(format($$select * from public.latest_coach_scans(%L)$$, :'ws_a'), '42501', null, 'anon cannot call it');
reset role;

select * from finish();
rollback;
