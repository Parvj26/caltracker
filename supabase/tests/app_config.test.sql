begin;
select plan(17);

select tests.create_user('ac-user@t.local', 'App Config User') as u \gset

-- Rows a statement changed (RLS hides rows, so a refused update or delete changes none), or the SQLSTATE it failed with.
create function tests.ac_rows(q text) returns text
language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return sqlstate;
end;
$$;

-- Structure
select ok((select relrowsecurity from pg_class where oid = 'public.app_config'::regclass), 'app_config has RLS on');
select is((select count(*)::int from public.app_config), 1, 'app_config has exactly one row');
select results_eq($$select ios_min_build, ios_latest_build, ios_update_url from public.app_config$$,
  $$values (0, 0, 'https://testflight.apple.com/join/b9sDKA2B')$$, 'the row starts at build 0 (nobody blocked)');
select throws_ok($$insert into public.app_config (id) values (false)$$, '23514', null, 'a second row is refused (check)');
select throws_ok($$insert into public.app_config default values$$, '23505', null, 'a second row is refused (key)');
select table_privs_are('public', 'app_config', 'anon', array['SELECT'], 'anon may only select app_config');
select table_privs_are('public', 'app_config', 'authenticated', array['SELECT'], 'authenticated may only select app_config');
select table_privs_are('public', 'app_config', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has select/insert/update/delete on app_config');

-- Signed out (anon)
select tests.act_as_anon();
select is((select ios_min_build from public.app_config), 0, 'anon reads the config');
select is(tests.ac_rows($$update public.app_config set ios_min_build = 99$$), '42501', 'anon cannot update');
select is(tests.ac_rows($$insert into public.app_config (id) values (true)$$), '42501', 'anon cannot insert');
select is(tests.ac_rows($$delete from public.app_config$$), '42501', 'anon cannot delete');
reset role;

-- Signed in (authenticated)
select tests.act_as(:'u');
select is((select ios_latest_build from public.app_config), 0, 'a signed-in user reads the config');
select is(tests.ac_rows($$update public.app_config set ios_min_build = 99$$), '42501', 'a signed-in user cannot update');
select is(tests.ac_rows($$insert into public.app_config (id) values (true)$$), '42501', 'a signed-in user cannot insert');
select is(tests.ac_rows($$delete from public.app_config$$), '42501', 'a signed-in user cannot delete');
reset role;

-- The runbook's statement (as postgres) moves both numbers and the timestamp.
update public.app_config set ios_latest_build = 4, ios_min_build = 4, updated_at = '2000-01-01';
update public.app_config set ios_latest_build = 4, ios_min_build = 4;
select ok((select ios_min_build = 4 and ios_latest_build = 4 and updated_at > '2000-01-02' from public.app_config),
  'the release update sets both builds and touches updated_at');

select * from finish();
rollback;
