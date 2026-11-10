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

create or replace function tests.create_invite(
  ws uuid, email text, full_name text, created_by uuid, token text,
  expires_at timestamptz default now() + interval '14 days',
  sent_at timestamptz default null
) returns uuid
language plpgsql
as $$
declare
  inv uuid;
begin
  -- full_name is generated: store the name split the same way as the migration backfill.
  insert into public.client_invites (
    workspace_id, email, first_name, last_name, token_hash, expires_at, sent_at, created_by
  ) values (
    ws, email, (public.split_full_name(full_name))[1], (public.split_full_name(full_name))[2],
    encode(extensions.digest(token, 'sha256'), 'hex'),
    expires_at, coalesce(sent_at, least(now(), expires_at - interval '1 second')), created_by
  ) returning id into inv;
  return inv;
end;
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

-- Like act_as, with the JWT's authenticator assurance level: 'aal1' = password only, 'aal2' = two-step done.
-- The admin_* functions need aal2.
create or replace function tests.act_as_aal(user_id uuid, aal text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_id, 'role', 'authenticated', 'aal', aal)::text, true);
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

-- A built-in exercise when ws is null, otherwise a custom exercise of ws.
create or replace function tests.create_exercise(
  ws uuid, name text, tt public.tracking_type default 'weight_reps'
) returns uuid
language plpgsql
as $$
declare
  ex uuid;
begin
  insert into public.exercises (workspace_id, source, name, tracking_type)
  values (ws, case when ws is null then 'builtin' else 'custom' end, name, tt)
  returning id into ex;
  return ex;
end;
$$;

-- A workout with 1 straight block, 1 exercise (a new built-in when ex is null) and two sets:
-- normal (8 reps, 60 kg, rest 90) then a drop to failure. A library workout when client is null.
create or replace function tests.create_workout(
  ws uuid, name text, client uuid default null, on_date date default null, ex uuid default null
) returns uuid
language plpgsql
as $$
declare
  w uuid;
  b uuid;
  we uuid;
begin
  if ex is null then
    ex := tests.create_exercise(null, name || ' exercise');
  end if;
  insert into public.workouts (workspace_id, client_id, scheduled_on, name)
  values (ws, client, on_date, name) returning id into w;
  insert into public.workout_blocks (workout_id, position, kind) values (w, 0, 'straight') returning id into b;
  insert into public.workout_exercises (block_id, position, exercise_id) values (b, 0, ex) returning id into we;
  insert into public.workout_sets (workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, rest_seconds)
  values (we, 0, 'normal', 8, 8, 60, 90);
  insert into public.workout_sets (workout_exercise_id, position, set_type, to_failure)
  values (we, 1, 'drop', true);
  return w;
end;
$$;

-- A workout log for client in ws (planned from workout, or unplanned when null) with 1 straight block,
-- 1 exercise (a new built-in) and two sets: the first completed at 8 x 60 kg, the second not done.
-- finished_at is set for a completed log only.
create or replace function tests.create_log(
  ws uuid, client uuid, workout uuid default null, status text default 'completed'
) returns uuid
language plpgsql
as $$
declare
  l uuid;
  b uuid;
  le uuid;
  ex uuid := tests.create_exercise(null, 'Log exercise ' || left(gen_random_uuid()::text, 8));
begin
  insert into public.workout_logs (workspace_id, client_id, workout_id, name, status, started_at,
    finished_at, last_activity_at, logged_by)
  values (ws, client, workout, coalesce((select w.name from public.workouts w where w.id = workout), 'Logged workout'),
    status::public.log_status, now() - interval '1 hour',
    case when status = 'completed' then now() - interval '10 minutes' end,
    now() - interval '10 minutes', client)
  returning id into l;
  insert into public.log_blocks (log_id, position, kind) values (l, 0, 'straight') returning id into b;
  insert into public.log_exercises (block_id, position, exercise_id) values (b, 0, ex) returning id into le;
  insert into public.log_sets (log_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, rest_seconds, actual_reps, actual_weight_kg, completed_at)
  values (le, 0, 'normal', 8, 8, 60, 90, 8, 60, now() - interval '10 minutes');
  insert into public.log_sets (log_exercise_id, position, set_type, target_reps_min, target_reps_max,
    target_weight_kg, rest_seconds)
  values (le, 1, 'normal', 8, 8, 60, 90);
  return l;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select pass('test helpers installed');
select * from finish();
