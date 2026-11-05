begin;
select plan(33);

-- Fixtures (as postgres)
select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

-- Trigger
select is((select full_name from public.profiles where id = :'a1'), 'Client A1',
  'profile auto-created with full_name from auth metadata');

-- Privileges: anon has nothing; authenticated has no insert/delete
select ok(not has_table_privilege('anon', 'public.profiles', 'select'), 'anon has no select on profiles');
select ok(not has_table_privilege('anon', 'public.workspaces', 'select'), 'anon has no select on workspaces');
select ok(not has_table_privilege('anon', 'public.workspace_members', 'select'), 'anon has no select on workspace_members');
select ok(not has_table_privilege('authenticated', 'public.workspace_members', 'insert')
  and not has_table_privilege('authenticated', 'public.workspace_members', 'update')
  and not has_table_privilege('authenticated', 'public.workspace_members', 'delete'),
  'authenticated cannot write workspace_members');

select ok(not has_table_privilege('anon', 'public.profiles', 'select,insert,update,delete'), 'anon has no privileges on profiles');
select ok(not has_table_privilege('anon', 'public.workspaces', 'select,insert,update,delete'), 'anon has no privileges on workspaces');
select ok(not has_table_privilege('anon', 'public.workspace_members', 'select,insert,update,delete'), 'anon has no privileges on workspace_members');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'insert,delete'), 'authenticated cannot insert/delete profiles');
select ok(not has_table_privilege('authenticated', 'public.workspaces', 'insert,delete'), 'authenticated cannot insert/delete workspaces');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'update'), 'authenticated cannot update profiles.id');
select ok(not has_column_privilege('authenticated', 'public.workspaces', 'id', 'update'), 'authenticated cannot update workspaces.id');

-- profiles as A1
select tests.act_as(:'a1');
select is((select count(*)::int from public.profiles where id = :'a1'), 1, 'A1 selects own profile');
select is((select count(*)::int from public.profiles where id = :'a2'), 1, 'A1 sees A2 (same workspace)');
select is((select full_name from public.profiles where id = :'a2'), 'Client A2', 'A1 reads A2 full_name');
select is((select count(*)::int from public.profiles where id = :'b1'), 0, 'A1 cannot see B1');
update public.profiles set first_name = 'A1', last_name = 'Renamed' where id = :'a1';
select is((select full_name from public.profiles where id = :'a1'), 'A1 Renamed', 'A1 updates own profile');
update public.profiles set first_name = 'Hacked' where id = :'a2';
reset role;
select is((select full_name from public.profiles where id = :'a2'), 'Client A2', 'A1 cannot update A2 profile');

-- profiles as coach A
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.profiles where id = :'a1'), 1, 'coach A selects A1');
select is((select count(*)::int from public.profiles where id = :'b1'), 0, 'coach A cannot select B1');

-- workspaces
select tests.act_as(:'a1');
select results_eq($$select id from public.workspaces$$, array[:'ws_a'::uuid], 'A1 sees exactly workspace A');
update public.workspaces set name = 'Hacked' where id = :'ws_a';
update public.workspaces set badge_style = 'plain' where id = :'ws_a';
reset role;
select is((select name from public.workspaces where id = :'ws_a'), 'Workspace A', 'A1 cannot update workspace A');
select is((select badge_style from public.workspaces where id = :'ws_a'), 'animals', 'A1 cannot update workspace A badge_style');

select tests.act_as(:'coach_a');
select results_eq($$select id from public.workspaces$$, array[:'ws_a'::uuid], 'coach A sees exactly workspace A');
update public.workspaces set name = 'Renamed A' where id = :'ws_a';
update public.workspaces set name = 'Hacked' where id = :'ws_b';
reset role;
select is((select name from public.workspaces where id = :'ws_a'), 'Renamed A', 'coach A updates workspace A');
select is((select name from public.workspaces where id = :'ws_b'), 'Workspace B', 'coach A cannot update workspace B');

-- workspace_members
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.workspace_members), 3, 'coach A sees all 3 members of A');
select throws_ok(
  format($$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'client')$$, :'ws_a', :'b1'),
  '42501', null, 'coach cannot insert members via API');
select throws_ok($$update public.workspace_members set role = 'owner'$$, '42501', null, 'coach cannot update members');
select throws_ok($$delete from public.workspace_members$$, '42501', null, 'coach cannot delete members');
reset role;

select tests.act_as(:'a1');
select results_eq($$select user_id from public.workspace_members$$, array[:'a1'::uuid], 'A1 sees only own membership');
reset role;

-- anon
select tests.act_as_anon();
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon cannot select profiles');
reset role;

-- one workspace per client
select throws_ok(
  format($$insert into public.workspace_members (workspace_id, user_id, role) values (%L, %L, 'client')$$, :'ws_b', :'a1'),
  '23505', null, 'client cannot belong to two workspaces');

select * from finish();
rollback;
