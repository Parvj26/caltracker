begin;
select plan(16);

-- Trimming matches JavaScript's trim(): tabs and newlines count as whitespace, not only spaces.
select is(public.split_full_name(E'\tSam Lee'), array['Sam', 'Lee'], 'a tab-prefixed legacy name splits correctly');
select is(public.split_full_name(E'Sam Lee\n'), array['Sam', 'Lee'], 'a trailing newline is trimmed');
select is(public.split_full_name(E' \t Mary Ann Smith \r\n'), array['Mary', 'Ann Smith'],
  'mixed surrounding whitespace is trimmed');
select is(public.split_full_name(E'Sam\tLee'), array['Sam', 'Lee'], 'a tab between the names separates them');
select is(public.split_full_name(E'\t\n'), array['', ''], 'whitespace only splits into two empty parts');

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

select pg_temp.user_with_meta('nl-tab@t.local', jsonb_build_object('first_name', E'\tSam\n', 'last_name', E' Lee\t'))
  as tab_user \gset
select results_eq(format($q$select first_name, last_name, full_name from public.profiles where id = %L$q$, :'tab_user'),
  $q$values ('Sam'::text, 'Lee'::text, 'Sam Lee'::text)$q$, 'sign-up trims tabs and newlines from first/last name');
select pg_temp.user_with_meta('nl-ws@t.local', jsonb_build_object('first_name', E'\t', 'last_name', E'\n',
  'full_name', E'\tMary Ann Smith')) as ws_user \gset
select results_eq(format($q$select first_name, last_name from public.profiles where id = %L$q$, :'ws_user'),
  $q$values ('Mary'::text, 'Ann Smith'::text)$q$,
  'whitespace-only first/last count as empty, so the tab-prefixed legacy full_name is used');
select pg_temp.user_with_meta('nl-long@t.local', jsonb_build_object('first_name', repeat('a', 150),
  'last_name', repeat('b', 150))) as long_user \gset
select results_eq(format($q$select char_length(first_name), char_length(last_name) from public.profiles where id = %L$q$,
  :'long_user'), $q$values (100, 100)$q$, 'sign-up never fails on a long name: it is cut to 100 characters');

-- Length limit: 100 characters for first and last name, on profiles and client_invites.
select tests.create_user('nl-client@t.local', 'Long Name') as client \gset
select tests.create_user('nl-coach@t.local', 'Nl Coach') as coach \gset
select tests.create_workspace('NL Workspace', :'coach') as ws \gset
select tests.add_client(:'ws', :'client');

select tests.act_as(:'client');
select lives_ok(format($q$update public.profiles set first_name = repeat('a', 100), last_name = repeat('b', 100)
  where id = %L$q$, :'client'), 'exactly 100 characters is allowed');
select throws_ok(format($q$update public.profiles set first_name = repeat('a', 101) where id = %L$q$, :'client'),
  '23514', null, 'a 101-character first name is rejected');
select throws_ok(format($q$update public.profiles set last_name = repeat('b', 101) where id = %L$q$, :'client'),
  '23514', null, 'a 101-character last name is rejected');
reset role;

select lives_ok(format($q$insert into public.client_invites (workspace_id, email, first_name, last_name, token_hash,
  created_by) values (%L, 'nl-ok@t.local', repeat('a', 100), repeat('b', 100), 'h-nl-ok', %L)$q$, :'ws', :'coach'),
  'an invite with 100-character names is allowed');
select throws_ok(format($q$insert into public.client_invites (workspace_id, email, first_name, token_hash, created_by)
  values (%L, 'nl-f@t.local', repeat('a', 101), 'h-nl-f', %L)$q$, :'ws', :'coach'),
  '23514', null, 'an invite with a 101-character first name is rejected');
select throws_ok(format($q$insert into public.client_invites (workspace_id, email, first_name, last_name, token_hash,
  created_by) values (%L, 'nl-l@t.local', 'Ok', repeat('b', 101), 'h-nl-l', %L)$q$, :'ws', :'coach'),
  '23514', null, 'an invite with a 101-character last name is rejected');
select throws_ok($q$update public.client_invites set last_name = repeat('b', 101) where email = 'nl-ok@t.local'$q$,
  '23514', null, 'an invite cannot be updated to a 101-character last name');

-- The constraints count characters, not bytes: 100 accented letters fit.
select lives_ok(format($q$update public.profiles set first_name = repeat('é', 100) where id = %L$q$, :'client'),
  '100 multi-byte characters are allowed');

select * from finish();
rollback;
