begin;
select plan(9);

select tests.create_user('mcp-coach@t.local', 'Mia Coach') as coach \gset
select tests.create_workspace('MCP Coaching', :'coach') as ws \gset
select tests.create_user('mcp-staff@t.local', 'Stan Staff') as staff \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'staff', 'staff');
select tests.create_user('mcp-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('mcp-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('mcp-coach2@t.local', 'Oli Other') as coach2 \gset
select tests.create_workspace('MCP Other', :'coach2') as ws2 \gset
select tests.create_user('mcp-ana@t.local', 'Ana Ruiz') as ana \gset
select tests.add_client(:'ws2', :'ana');

update public.profiles set bio = 'Strength coach.', avatar_path = id::text || '/avatar.webp' where id = :'coach';
update public.profiles set bio = 'Other bio.' where id = :'coach2';

select ok(not has_function_privilege('anon', 'public.get_my_coach_profile()', 'execute'), 'anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.get_my_coach_profile()', 'execute'), 'signed-in users can call it');

select tests.act_as(:'sam');
select results_eq(
  'select coach_name, business_name, bio, avatar_path from public.get_my_coach_profile()',
  format($$values ('Mia Coach'::text, 'MCP Coaching'::text, 'Strength coach.'::text, %L::text)$$, :'coach' || '/avatar.webp'),
  'a client gets their own coach''s card (the owner, not staff)');
reset role;
select tests.act_as(:'ana');
select results_eq('select coach_name, bio from public.get_my_coach_profile()',
  $$values ('Oli Other'::text, 'Other bio.'::text)$$, 'a client of another workspace gets only their own coach');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.get_my_coach_profile()), 0, 'a coach is nobody''s client, so gets nothing');
reset role;
select tests.act_as(:'staff');
select is((select count(*)::int from public.get_my_coach_profile()), 0, 'staff get nothing');
reset role;

delete from public.workspace_members where workspace_id = :'ws' and user_id = :'kim';
select tests.act_as(:'kim');
select is((select count(*)::int from public.get_my_coach_profile()), 0, 'a removed client gets no coach');
reset role;
select tests.act_as(:'sam');
select is((select count(*)::int from public.get_my_coach_profile()), 1, 'returns one row, never other coaches');
reset role;

set local role anon;
select throws_ok('select * from public.get_my_coach_profile()', '42501', null, 'anon is refused outright');
reset role;

select * from finish();
rollback;
