-- The owner Overview (admin_owner_overview), test workspaces (workspaces.is_test) and the phone's build number
-- (push_devices.app_build).
begin;
select plan(17);

select tests.create_user('oo-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('oo-nobody@t.local', 'No Body') as nobody \gset
insert into public.admin_users (user_id, role) values (:'owner', 'owner');

-- The local database may hold other data: numbers are checked as differences from before this file's seed.
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select public.admin_owner_overview(false) as base \gset
select public.admin_owner_overview(true) as base_t \gset
select set_config('request.jwt.claims', '', true);

select ok(not has_function_privilege('anon', 'public.admin_owner_overview(boolean)', 'execute'), 'anon cannot call it');
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok('select public.admin_owner_overview()', '42501', 'admin: not authorised', 'a non-admin is refused');
reset role;
select tests.act_as_aal(:'owner', 'aal1');
select throws_ok('select public.admin_owner_overview()', '42501', 'admin: not authorised', 'aal1 is refused');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'workspaces' and column_name = 'is_test'), 'false', 'is_test defaults to false');

-- A real coach (Ann) and a test coach (Tom), each with one client added this week.
select tests.create_user('oo-ann@t.local', 'Ann Coach') as ann \gset
select tests.create_workspace('OO Real', :'ann') as ws \gset
select tests.create_user('oo-tom@t.local', 'Tom Test') as tom \gset
select tests.create_workspace('OO Test', :'tom') as ws_t \gset
update public.workspaces set is_test = true where id = :'ws_t';
select tests.create_user('oo-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('oo-tia@t.local', 'Tia Test') as tia \gset
select tests.add_client(:'ws_t', :'tia');
-- Last week: Kim joined Ann.
select tests.create_user('oo-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
update public.workspace_members set created_at = private.admin_week_start() - interval '2 days' where user_id = :'kim';

-- Invites: one sent and joined this week in each workspace.
select tests.create_invite(:'ws', 'oo-sam@t.local', 'Sam Lee', :'ann', 'tok-oo-sam-0000000000000') as inv \gset
update public.client_invites set accepted_at = now(), accepted_by = :'sam' where id = :'inv';
select tests.create_invite(:'ws_t', 'oo-tia@t.local', 'Tia Test', :'tom', 'tok-oo-tia-0000000000000');

-- Usage this week: Sam logs a workout and a meal, two Apple Health readings and a manual one, a post and a message.
-- Kim's first Apple Health reading was last week (not a new connection this week). Tia does the same in the test gym.
select tests.create_log(:'ws', :'sam') as log_sam \gset
update public.workout_logs set finished_at = now() where id = :'log_sam';
insert into public.meals (workspace_id, client_id, eaten_at, eaten_on, name, calories)
values (:'ws', :'sam', now(), current_date, 'OO Lunch', 500), (:'ws_t', :'tia', now(), current_date, 'OO Tia', 500);
insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on, source, entered_by_role, external_id, created_at)
values (:'ws', :'sam', 'weight_kg', 80, current_date, 'apple_health', 'client', 'oo-1', now()),
  (:'ws', :'sam', 'weight_kg', 81, current_date, 'apple_health', 'client', 'oo-2', now()),
  (:'ws', :'kim', 'weight_kg', 70, current_date, 'apple_health', 'client', 'oo-3', private.admin_week_start() - interval '1 day'),
  (:'ws', :'kim', 'weight_kg', 71, current_date, 'apple_health', 'client', 'oo-4', now()),
  (:'ws_t', :'tia', 'weight_kg', 60, current_date, 'apple_health', 'client', 'oo-5', now());
insert into public.body_metrics (workspace_id, client_id, metric_key, value, measured_on, source, entered_by_role)
values (:'ws', :'sam', 'waist_cm', 80, current_date, 'manual', 'client');
insert into public.community_posts (community_id, workspace_id, author_id, body)
select c.id, :'ws', :'sam', 'OO post' from public.communities c where c.workspace_id = :'ws';
insert into public.conversations (workspace_id, client_id) values (:'ws', :'sam') returning id as conv \gset
insert into public.messages (conversation_id, sender_id, body) values (:'conv', :'sam', 'Hi');

-- Failed push in each workspace.
insert into public.push_outbox (user_id, workspace_id, type, group_key, attempts, outcome, last_error)
values (:'sam', :'ws', 'message', 'oo-f1', 5, 'failed', 'x'), (:'tia', :'ws_t', 'message', 'oo-f2', 5, 'failed', 'x');

select tests.act_as_aal(:'owner', 'aal2');
select public.admin_owner_overview(false) as now_o \gset
select public.admin_owner_overview(true) as now_t \gset
select results_eq('select is_test from public.admin_coaches() where workspace_id in (' || quote_literal(:'ws') || ', '
  || quote_literal(:'ws_t') || ') order by name', $$values (false), (true)$$, 'admin_coaches says which rows are test');
reset role;

-- d(path): this_week difference from the base, without and with test accounts.
create function pg_temp.d(n jsonb, b jsonb, variadic p text[]) returns int language sql as $$
  select (n #>> p)::int - (b #>> p)::int $$;

select results_eq(format($$select pg_temp.d(%1$L, %2$L, 'growth', 'new_coaches', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'growth', 'clients_added', 'this_week'), pg_temp.d(%1$L, %2$L, 'growth', 'clients_added', 'last_week'),
    pg_temp.d(%1$L, %2$L, 'growth', 'invites_sent', 'this_week'), pg_temp.d(%1$L, %2$L, 'growth', 'invites_joined', 'this_week')$$,
    :'now_o', :'base'),
  $$values (1, 1, 1, 1, 1)$$, 'growth without test accounts: Ann, Sam (Kim last week), one invite sent and joined');
select results_eq(format($$select pg_temp.d(%1$L, %2$L, 'growth', 'new_coaches', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'growth', 'clients_added', 'this_week'), pg_temp.d(%1$L, %2$L, 'growth', 'invites_sent', 'this_week')$$,
    :'now_t', :'base_t'),
  $$values (2, 2, 2)$$, 'growth with test accounts counts Tom, Tia and her invite too');

select results_eq(format($$select pg_temp.d(%1$L, %2$L, 'usage', 'workouts', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'usage', 'meals', 'this_week'), pg_temp.d(%1$L, %2$L, 'usage', 'metrics', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'usage', 'metrics', 'apple_health_this_week'), pg_temp.d(%1$L, %2$L, 'usage', 'metrics', 'last_week'),
    pg_temp.d(%1$L, %2$L, 'usage', 'new_connections', 'this_week'), pg_temp.d(%1$L, %2$L, 'usage', 'posts', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'usage', 'messages', 'this_week')$$, :'now_o', :'base'),
  $$values (1, 1, 4, 3, 1, 1, 1, 1)$$,
  'usage without test accounts: workouts, meals, metrics (3 from Apple Health), new connections (Sam, not Kim), posts, messages');
select results_eq(format($$select pg_temp.d(%1$L, %2$L, 'usage', 'meals', 'this_week'),
    pg_temp.d(%1$L, %2$L, 'usage', 'metrics', 'this_week'), pg_temp.d(%1$L, %2$L, 'usage', 'new_connections', 'this_week')$$,
    :'now_t', :'base_t'),
  $$values (2, 5, 2)$$, 'usage with test accounts counts Tia too');
select results_eq(format($$select pg_temp.d(%1$L, %2$L, 'health', 'push_failed_24h'), pg_temp.d(%3$L, %4$L, 'health', 'push_failed_24h')$$,
    :'now_o', :'base', :'now_t', :'base_t'),
  $$values (1, 2)$$, 'failed notifications in 24 h: the test gym''s only with test accounts');
select ok((:'now_o'::jsonb -> 'health') ?& array['last_push_run_at', 'last_push_status'], 'health has the push sender''s last run');

-- Old builds: none while the minimum is 0; then people whose latest known build is below it.
update public.app_config set ios_min_build = 0;
insert into public.push_devices (token, user_id, app_version, app_build, updated_at) values
  (repeat('a1', 32), :'sam', '1.0.0', 4, now() - interval '2 days'),
  (repeat('a2', 32), :'sam', '1.0.0', 5, now() - interval '1 day'),
  (repeat('a3', 32), :'kim', '1.0.0', 4, now() - interval '1 day'),
  (repeat('a4', 32), :'kim', '1.0.0', 7, now()),
  (repeat('a5', 32), :'tia', '1.0.0', 3, now()),
  (repeat('a6', 32), :'ann', '1.0.0', null, now());
select tests.act_as_aal(:'owner', 'aal2');
select is(public.admin_owner_overview(false) #> '{health,old_builds}', '{"min_build": 0, "people": 0, "builds": []}'::jsonb,
  'no minimum build: nobody is on an old build');
reset role;
-- Other people's devices (the local database's own) are counted out with the same rule.
create temp table others as
  select distinct on (d.user_id) d.user_id, d.app_build from public.push_devices d
  where d.app_build is not null and d.user_id not in (:'sam', :'kim', :'tia', :'ann')
  order by d.user_id, d.updated_at desc;
grant select on others to authenticated;
update public.app_config set ios_min_build = 6;
select tests.act_as_aal(:'owner', 'aal2');
select results_eq($$select (o #>> '{health,old_builds,min_build}')::int,
    (o #>> '{health,old_builds,people}')::int - (select count(*)::int from others where app_build < 6),
    (o #> '{health,old_builds,builds}') @> '[5]' and not (o #> '{health,old_builds,builds}') @> '[3]'
    from (select public.admin_owner_overview(false) o) x$$,
  $$values (6, 1, true)$$, 'old builds: Sam''s latest is 5; Kim''s latest is 7; Ann has no build; Tia is test-only');
select is((public.admin_owner_overview(true) #>> '{health,old_builds,people}')::int
    - (select count(*)::int from others where app_build < 6),
  2, 'old builds with test accounts counts Tia too');
reset role;

-- register_push_device stores the build; an older build's call (no build) still works and clears it.
select tests.act_as(:'ann');
select lives_ok(format('select public.register_push_device(%L, %L, null, 9)', repeat('b1', 32), '1.1.0'), 'register with a build');
reset role;
select is((select app_build from public.push_devices where token = repeat('b1', 32)), 9, 'the build is saved');
select tests.act_as(:'ann');
select public.register_push_device(repeat('b1', 32), '1.0.0');
reset role;
select is((select app_build from public.push_devices where token = repeat('b1', 32)), null, 'an older build''s register clears it');

select * from finish();
rollback;
