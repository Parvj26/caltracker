begin;
select plan(46);

-- Columns: first/last are plain text, full_name is generated from them on both tables.
select has_column('public', 'profiles', 'first_name', 'profiles has first_name');
select has_column('public', 'profiles', 'last_name', 'profiles has last_name');
select col_not_null('public', 'profiles', 'first_name', 'profiles.first_name is not null');
select col_not_null('public', 'profiles', 'last_name', 'profiles.last_name is not null');
select col_default_is('public', 'profiles', 'first_name', '', 'profiles.first_name defaults to empty');
select col_default_is('public', 'profiles', 'last_name', '', 'profiles.last_name defaults to empty');
select has_column('public', 'client_invites', 'first_name', 'client_invites has first_name');
select has_column('public', 'client_invites', 'last_name', 'client_invites has last_name');
select col_not_null('public', 'client_invites', 'first_name', 'client_invites.first_name is not null');
select col_not_null('public', 'client_invites', 'last_name', 'client_invites.last_name is not null');
select is((select attgenerated::text from pg_attribute
  where attrelid = 'public.profiles'::regclass and attname = 'full_name'), 's',
  'profiles.full_name is a stored generated column');
select is((select attgenerated::text from pg_attribute
  where attrelid = 'public.client_invites'::regclass and attname = 'full_name'), 's',
  'client_invites.full_name is a stored generated column');
select col_not_null('public', 'profiles', 'full_name', 'profiles.full_name is not null');
select col_not_null('public', 'client_invites', 'full_name', 'client_invites.full_name is not null');

-- Split rule used by the backfill and the sign-up trigger: first word, then the rest.
select is(public.split_full_name('Sam Lee'), array['Sam', 'Lee'], 'splits on the first space');
select is(public.split_full_name('Mary Ann Smith'), array['Mary', 'Ann Smith'], 'everything after the first space is the last name');
select is(public.split_full_name('Cher'), array['Cher', ''], 'a single name has an empty last name');
select is(public.split_full_name('  Sam   Lee  '), array['Sam', 'Lee'], 'surrounding and repeated spaces are ignored');
select is(public.split_full_name(''), array['', ''], 'an empty name splits into two empty parts');
select is(public.split_full_name(null), array['', ''], 'a null name splits into two empty parts');
select ok(not has_function_privilege('anon', 'public.split_full_name(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.split_full_name(text)', 'execute'),
  'anon and authenticated cannot call split_full_name');

-- Sign-up trigger
select tests.create_user('legacy@t.local', 'Mary Ann Smith') as legacy \gset
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'legacy'),
  $q$values ('Mary'::text, 'Ann Smith'::text, 'Mary Ann Smith'::text)$q$,
  'legacy full_name metadata is split on the first space');

create function pg_temp.user_with_meta(email text, meta jsonb) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', email, '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, meta, now(), now());
  return uid;
end;
$$;

select pg_temp.user_with_meta('split@t.local', '{"first_name":" Sam ","last_name":" Lee "}') as split_user \gset
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'split_user'),
  $q$values ('Sam'::text, 'Lee'::text, 'Sam Lee'::text)$q$,
  'first_name/last_name metadata is used (trimmed)');
select pg_temp.user_with_meta('both@t.local', '{"first_name":"Sam","last_name":"Lee","full_name":"Other Person"}') as both_user \gset
select results_eq(format($q$select first_name, last_name from public.profiles where id = %L$q$, :'both_user'),
  $q$values ('Sam'::text, 'Lee'::text)$q$, 'first/last metadata wins over a legacy full_name');
select pg_temp.user_with_meta('mono@t.local', '{"first_name":"Cher"}') as mono \gset
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'mono'),
  $q$values ('Cher'::text, ''::text, 'Cher'::text)$q$, 'a first name alone gives an empty last name');
select pg_temp.user_with_meta('none@t.local', '{}') as none_user \gset
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'none_user'),
  $q$values (''::text, ''::text, ''::text)$q$, 'no name metadata gives empty names');

-- Privileges
select ok(has_column_privilege('authenticated', 'public.profiles', 'first_name', 'update')
  and has_column_privilege('authenticated', 'public.profiles', 'last_name', 'update'),
  'authenticated can update own first_name/last_name (RLS limits the rows)');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'update'),
  'authenticated has no update grant on the generated full_name');
select ok(not has_column_privilege('anon', 'public.profiles', 'first_name', 'select')
  and not has_column_privilege('anon', 'public.profiles', 'first_name', 'update'),
  'anon has nothing on profiles.first_name');
select ok(not has_any_column_privilege('authenticated', 'public.client_invites', 'insert')
  and not has_any_column_privilege('authenticated', 'public.client_invites', 'update'),
  'authenticated still cannot write client_invites');
select ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
  and not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),
  'handle_new_user cannot be called directly');

-- RLS still holds for the new columns
select tests.create_user('fl-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('fl-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('fl-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('fl-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('fl-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('FL Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('FL Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');

select tests.act_as(:'a1');
update public.profiles set first_name = 'Alex', last_name = 'Rivera' where id = :'a1';
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'a1'),
  $q$values ('Alex'::text, 'Rivera'::text, 'Alex Rivera'::text)$q$, 'A1 renames self; full_name follows');
update public.profiles set first_name = 'Hacked' where id = :'a2';
update public.profiles set last_name = 'Hacked' where id = :'b1';
select throws_ok(format($q$update public.profiles set full_name = 'X' where id = %L$q$, :'a1'),
  '428C9', null, 'full_name cannot be written directly');
reset role;
select is((select first_name from public.profiles where id = :'a2'), 'Client', 'A1 cannot rename A2 (same workspace)');
select is((select last_name from public.profiles where id = :'b1'), 'B1', 'A1 cannot rename B1 (other workspace)');

select tests.act_as(:'coach_a');
select is((select first_name from public.profiles where id = :'a1'), 'Alex', 'coach A reads own client''s first name');
select is((select count(*)::int from public.profiles where id = :'b1'), 0, 'coach A cannot read a client of B');
update public.profiles set first_name = 'Hacked' where id = :'a1';
reset role;
select is((select first_name from public.profiles where id = :'a1'), 'Alex', 'coach A cannot rename a client');

-- client_invites: full_name is generated from first/last
insert into public.client_invites (workspace_id, email, first_name, last_name, token_hash, created_by)
values (:'ws_a', 'fl-x@t.local', 'Priya', 'Rao', encode(extensions.digest('tok-fl-x', 'sha256'), 'hex'), :'coach_a');
select is((select full_name from public.client_invites where email = 'fl-x@t.local'), 'Priya Rao',
  'invite full_name is first + last');
insert into public.client_invites (workspace_id, email, first_name, token_hash, created_by)
values (:'ws_a', 'fl-y@t.local', 'Cher', 'h-fl-y', :'coach_a');
select is((select full_name from public.client_invites where email = 'fl-y@t.local'), 'Cher',
  'invite with no last name has no trailing space');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, full_name, token_hash, created_by) values (%L, 'fl-z@t.local', 'Z', 'h-fl-z', %L)$q$,
  :'ws_a', :'coach_a'), '428C9', null, 'invite full_name cannot be inserted directly');
select tests.create_invite(:'ws_a', 'fl-h@t.local', 'Helper Made Name', :'coach_a', 'tok-fl-h') as inv_h \gset
select results_eq(format($q$select first_name, last_name, full_name from public.client_invites where id = %L$q$, :'inv_h'),
  $q$values ('Helper'::text, 'Made Name'::text, 'Helper Made Name'::text)$q$,
  'test helper splits a full name into first/last');

select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_invites where email = 'fl-x@t.local'), 0,
  'coach B cannot see A''s invite names');
reset role;

-- Invite preview returns the split name
select tests.act_as_anon();
select results_eq($q$select first_name, last_name, full_name from public.get_invite_preview('tok-fl-x')$q$,
  $q$values ('Priya'::text, 'Rao'::text, 'Priya Rao'::text)$q$, 'preview returns first, last and full name');
select ok((select first_name is null and last_name is null from public.get_invite_preview('no-such-token')),
  'not_found preview has null names');
reset role;
select ok(has_function_privilege('anon', 'public.get_invite_preview(text)', 'execute')
  and not has_function_privilege('public', 'public.get_invite_preview(text)', 'execute'),
  'preview stays callable by anon and not granted to public');

select * from finish();
rollback;
