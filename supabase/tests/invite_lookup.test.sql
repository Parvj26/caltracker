begin;
select plan(5);

select tests.create_user('lk-coach@t.local', 'Coach') as coach \gset
select tests.create_user('lk-client@t.local', 'Client') as cl \gset
select tests.create_workspace('Lookup WS', :'coach') as ws \gset
select tests.add_client(:'ws', :'cl');

select ok(not has_function_privilege('anon', 'public.lookup_members_by_email(text[])', 'execute'),
  'anon cannot execute lookup_members_by_email');
select ok(not has_function_privilege('authenticated', 'public.lookup_members_by_email(text[])', 'execute'),
  'authenticated cannot execute lookup_members_by_email');
select ok(has_function_privilege('service_role', 'public.lookup_members_by_email(text[])', 'execute'),
  'service_role can execute lookup_members_by_email');

select is(
  (select role::text from public.lookup_members_by_email(array['LK-Client@t.local ']) ),
  'client', 'finds a client case-insensitively');
select is(
  (select role::text from public.lookup_members_by_email(array['lk-coach@t.local'])),
  'owner', 'finds an owner');

select * from finish();
rollback;
