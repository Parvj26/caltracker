-- Test helpers. Committed (not rolled back) so later test files can use them.
set check_function_bodies = off;
-- Local/CI test database only; never part of a migration.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_user(
  email text, full_name text, confirmed boolean default true
) returns uuid
language plpgsql
as $$
declare
  uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    email, '', case when confirmed then now() else null end,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', full_name),
    now(), now()
  );
  return uid;
end;
$$;

create or replace function tests.create_workspace(name text, owner uuid)
returns uuid
language plpgsql
as $$
declare
  ws uuid;
begin
  insert into public.workspaces (name) values (name) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, owner, 'owner');
  return ws;
end;
$$;

create or replace function tests.add_client(ws uuid, client uuid)
returns void
language sql
as $$
  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, client, 'client');
$$;

create or replace function tests.act_as(user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;

create or replace function tests.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select pass('test helpers installed');
select * from finish();
