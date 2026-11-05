begin;
select plan(14);

select tests.create_user('mc-coach@t.local', 'Mia Coach') as coach \gset
select tests.create_workspace('MC Coaching', :'coach') as ws \gset
select tests.create_user('mc-staff@t.local', 'Stan Staff') as staff \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'staff', 'staff');
select tests.create_user('mc-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('mc-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('mc-coach2@t.local', 'Oli Other') as coach2 \gset
select tests.create_workspace('MC Other', :'coach2') as ws2 \gset
select tests.create_user('mc-ana@t.local', 'Ana Ruiz') as ana \gset
select tests.add_client(:'ws2', :'ana');

-- get_my_coach(): the name of the owner of the caller's current workspace, nothing else.
select ok(not has_function_privilege('anon', 'public.get_my_coach()', 'execute'), 'anon cannot call get_my_coach');
select ok(has_function_privilege('authenticated', 'public.get_my_coach()', 'execute'),
  'signed-in users can call get_my_coach (it only ever answers about the caller)');

select tests.act_as(:'sam');
select results_eq('select coach_name from public.get_my_coach()', $$values ('Mia Coach'::text)$$,
  'a client gets their own coach''s name (the owner, not staff)');
reset role;
select tests.act_as(:'ana');
select results_eq('select coach_name from public.get_my_coach()', $$values ('Oli Other'::text)$$,
  'a client of another workspace gets only their own coach');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.get_my_coach()), 0, 'a coach is nobody''s client, so gets nothing');
reset role;

-- A removed client no longer has a coach.
delete from public.workspace_members where workspace_id = :'ws' and user_id = :'kim';
select tests.act_as(:'kim');
select is((select count(*)::int from public.get_my_coach()), 0, 'a removed client gets no coach');
reset role;

-- Units: a client can change only their own profiles.units.
select tests.act_as(:'sam');
with u as (update public.profiles set units = 'lb' where id = :'sam' returning 1)
select is((select count(*)::int from u), 1, 'a client can change their own units');
with u as (update public.profiles set units = 'lb' where id = :'kim' returning 1)
select is((select count(*)::int from u), 0, 'a client cannot change another client''s units (same workspace)');
with u as (update public.profiles set units = 'lb' where id = :'coach' returning 1)
select is((select count(*)::int from u), 0, 'a client cannot change their coach''s units');
with u as (update public.profiles set units = 'lb' where id = :'ana' returning 1)
select is((select count(*)::int from u), 0, 'a client cannot change units in another workspace');
select throws_ok(format('update public.profiles set units = %L where id = %L', 'stone', :'sam'), '23514', null,
  'units must be kg or lb');
select throws_ok(format('update public.profiles set created_at = now() where id = %L', :'sam'), '42501', null,
  'only the granted columns can be changed');
reset role;
select is((select units from public.profiles where id = :'sam'), 'lb', 'Sam''s change was saved');
select is((select units from public.profiles where id = :'kim'), 'kg', 'Kim''s units were not touched');

select * from finish();
rollback;
