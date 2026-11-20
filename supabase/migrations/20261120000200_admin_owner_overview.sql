-- Admin site: the owner Overview (Coaches, Growth, Product health, Usage) and test accounts.
--
-- 1. workspaces.is_test: test workspaces are left out of every Overview and Coaches number unless "Show test accounts"
--    is on. 'Smoke Test' and 'Parv Test Gym' exist only on staging, so the update is a no-op elsewhere.
-- 2. push_devices.app_build: the iOS build number (CFBundleVersion) the phone sends when it registers its token, so the
--    Overview can count people on a build below app_config.ios_min_build. Older builds don't send it (null).
-- 3. admin_coaches gains is_test; admin_owner_overview(p_show_test) returns the Overview's numbers.
-- Weeks are Monday 00:00 UTC to Sunday (private.admin_week_start).

-- 1. Test workspaces ----------------------------------------------------------------------------------------------

alter table public.workspaces add column is_test boolean not null default false;
update public.workspaces set is_test = true where name in ('Smoke Test', 'Parv Test Gym');

-- Whether a workspace's rows count: always with p_show_test, otherwise only real (non-test) workspaces. Rows with no
-- workspace count.
create function private.admin_ws_counts(p_ws uuid, p_show_test boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_show_test or p_ws is null
    or not coalesce((select w.is_test from public.workspaces w where w.id = p_ws), false);
$$;

-- Whether a person counts: always with p_show_test, otherwise unless every workspace they belong to is a test one.
create function private.admin_user_counts(p_user uuid, p_show_test boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_show_test
    or not exists (select 1 from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
                   where m.user_id = p_user and w.is_test)
    or exists (select 1 from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
               where m.user_id = p_user and not w.is_test);
$$;

revoke execute on function private.admin_ws_counts(uuid, boolean), private.admin_user_counts(uuid, boolean)
  from public, anon, authenticated, service_role;

-- 2. The phone's build number -------------------------------------------------------------------------------------

alter table public.push_devices add column app_build integer check (app_build > 0);
grant select (app_build) on public.push_devices to authenticated;

-- As in 20261114000100_push_device_secret.sql, plus p_app_build (null from builds that don't send it). Each register
-- stores what the phone sent, so a phone back on an older build that sends none no longer shows a newer build.
drop function public.register_push_device(text, text, text);
create function public.register_push_device(p_token text, p_app_version text, p_secret text default null,
  p_app_build integer default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_row public.push_devices%rowtype;
  v_build integer := case when p_app_build > 0 then p_app_build end;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_secret is not null then
    if p_secret !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'bad device secret' using errcode = '22023';
    end if;
    v_hash := encode(pg_catalog.sha256(convert_to(p_secret, 'UTF8')), 'hex');
  end if;

  for v_try in 1..2 loop
    select * into v_row from public.push_devices d where d.token = p_token for update;
    exit when found;
    insert into public.push_devices (token, user_id, app_version, secret_hash, app_build)
    values (p_token, v_uid, p_app_version, v_hash, v_build)
    on conflict (token) do nothing;
    if found then
      return;
    end if;
  end loop;
  if v_row.token is null then
    raise exception 'could not register the push token, try again' using errcode = '40001';
  end if;

  if v_row.user_id = v_uid then
    update public.push_devices
    set app_version = p_app_version, app_build = v_build, secret_hash = coalesce(v_hash, secret_hash), updated_at = now()
    where token = p_token;
  elsif v_row.secret_hash is null or v_row.secret_hash = v_hash then
    update public.push_devices
    set user_id = v_uid, app_version = p_app_version, app_build = v_build, secret_hash = coalesce(v_hash, secret_hash),
      updated_at = now()
    where token = p_token;
  else
    raise exception 'this push token belongs to another device' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.register_push_device(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text, text, integer) to authenticated;

-- 3. Coaches: is_test ---------------------------------------------------------------------------------------------

-- As in 20261120000100_admin_truthful.sql, plus is_test (the page hides test rows unless "Show test accounts" is on).
drop function public.admin_coaches();
create function public.admin_coaches()
returns table (user_id uuid, name text, workspace_id uuid, workspace_name text, created_at timestamptz, clients integer,
  last_active timestamptz, workouts_built_week integer, programs_assigned_week integer, health text,
  role public.member_role, is_test boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week timestamptz;
begin
  perform private.admin_require('readonly');
  v_week := private.admin_week_start();
  return query
  select x.user_id, x.name, x.workspace_id, x.workspace_name, x.created_at, x.clients, x.last_active,
    x.workouts_built_week, x.programs_assigned_week, private.admin_coach_health(x.last_active), x.role, x.is_test
  from (
    select m.user_id, private.admin_name(m.user_id) as name, m.workspace_id, w.name as workspace_name, m.created_at,
      (select count(*)::integer from public.workspace_members c
       where c.workspace_id = m.workspace_id and c.role = 'client') as clients,
      private.admin_coach_last_active(m.user_id, m.workspace_id) as last_active,
      (select count(*)::integer from public.workouts wo
       where wo.workspace_id = m.workspace_id and wo.created_by = m.user_id and wo.assignment_id is null
         and wo.created_at >= v_week) as workouts_built_week,
      (select count(*)::integer from public.program_assignments pa
       where pa.workspace_id = m.workspace_id and pa.created_by = m.user_id
         and pa.created_at >= v_week) as programs_assigned_week,
      m.role, w.is_test
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.role in ('owner', 'staff')
  ) x
  order by x.name, x.workspace_name;
end;
$$;
revoke execute on function public.admin_coaches() from public, anon, authenticated;
grant execute on function public.admin_coaches() to authenticated;

-- 4. The owner Overview -------------------------------------------------------------------------------------------

-- Totals only (no client names). Each {this_week, last_week} pair counts Monday 00:00 UTC on, and the week before.
--   growth: new_coaches (first coach membership), clients_added (client memberships), invites_sent (new invites),
--     invites_joined (invites accepted);
--   usage: workouts (completed logs by finished_at), meals (by eaten_at), metrics (body metric readings by created_at,
--     with apple_health), new_connections (clients whose first Apple Health reading arrived that week), posts
--     (community posts), messages;
--   health: last_push_run_at / last_push_status (the push-send cron job, as on the old Overview), push_failed_24h,
--     old_builds {min_build, people, builds}: people whose latest device with a known build is below
--     app_config.ios_min_build (none while min_build is 0).
-- Test workspaces (and people only in test workspaces) are left out unless p_show_test.
create function public.admin_owner_overview(p_show_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week timestamptz;
  v_last timestamptz;
  v_min integer;
  v_push_at timestamptz;
  v_push_status text;
begin
  perform private.admin_require('readonly');
  v_week := private.admin_week_start();
  v_last := v_week - interval '7 days';
  select c.ios_min_build into v_min from public.app_config c limit 1;

  select d.start_time, d.status into v_push_at, v_push_status
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where j.jobname = 'push-send'
  order by d.start_time desc
  limit 1;

  return jsonb_build_object(
    'growth', jsonb_build_object(
      'new_coaches', (select jsonb_build_object(
          'this_week', count(*) filter (where c.joined >= v_week),
          'last_week', count(*) filter (where c.joined >= v_last and c.joined < v_week))
        from (select m.user_id, min(m.created_at) as joined from public.workspace_members m
              where m.role in ('owner', 'staff') and private.admin_ws_counts(m.workspace_id, p_show_test)
              group by m.user_id) c),
      'clients_added', (select jsonb_build_object(
          'this_week', count(*) filter (where m.created_at >= v_week),
          'last_week', count(*) filter (where m.created_at >= v_last and m.created_at < v_week))
        from public.workspace_members m
        where m.role = 'client' and m.created_at >= v_last and private.admin_ws_counts(m.workspace_id, p_show_test)),
      'invites_sent', (select jsonb_build_object(
          'this_week', count(*) filter (where i.created_at >= v_week),
          'last_week', count(*) filter (where i.created_at >= v_last and i.created_at < v_week))
        from public.client_invites i
        where i.created_at >= v_last and private.admin_ws_counts(i.workspace_id, p_show_test)),
      'invites_joined', (select jsonb_build_object(
          'this_week', count(*) filter (where i.accepted_at >= v_week),
          'last_week', count(*) filter (where i.accepted_at >= v_last and i.accepted_at < v_week))
        from public.client_invites i
        where i.accepted_at >= v_last and private.admin_ws_counts(i.workspace_id, p_show_test))),
    'usage', jsonb_build_object(
      'workouts', (select jsonb_build_object(
          'this_week', count(*) filter (where l.finished_at >= v_week),
          'last_week', count(*) filter (where l.finished_at >= v_last and l.finished_at < v_week))
        from public.workout_logs l
        where l.status = 'completed' and l.finished_at >= v_last and private.admin_ws_counts(l.workspace_id, p_show_test)),
      'meals', (select jsonb_build_object(
          'this_week', count(*) filter (where ml.eaten_at >= v_week),
          'last_week', count(*) filter (where ml.eaten_at >= v_last and ml.eaten_at < v_week))
        from public.meals ml
        where ml.eaten_at >= v_last and private.admin_ws_counts(ml.workspace_id, p_show_test)),
      'metrics', (select jsonb_build_object(
          'this_week', count(*) filter (where bm.created_at >= v_week),
          'last_week', count(*) filter (where bm.created_at >= v_last and bm.created_at < v_week),
          'apple_health_this_week', count(*) filter (where bm.created_at >= v_week and bm.source = 'apple_health'))
        from public.body_metrics bm
        where bm.created_at >= v_last and private.admin_ws_counts(bm.workspace_id, p_show_test)),
      'new_connections', (select jsonb_build_object(
          'this_week', count(*) filter (where f.first_at >= v_week),
          'last_week', count(*) filter (where f.first_at >= v_last and f.first_at < v_week))
        from (select bm.client_id, min(bm.created_at) as first_at from public.body_metrics bm
              where bm.source = 'apple_health' and private.admin_ws_counts(bm.workspace_id, p_show_test)
              group by bm.client_id) f),
      'posts', (select jsonb_build_object(
          'this_week', count(*) filter (where p.created_at >= v_week),
          'last_week', count(*) filter (where p.created_at >= v_last and p.created_at < v_week))
        from public.community_posts p
        where p.created_at >= v_last and private.admin_ws_counts(p.workspace_id, p_show_test)),
      'messages', (select jsonb_build_object(
          'this_week', count(*) filter (where msg.created_at >= v_week),
          'last_week', count(*) filter (where msg.created_at >= v_last and msg.created_at < v_week))
        from public.messages msg
        where msg.created_at >= v_last and private.admin_ws_counts(msg.workspace_id, p_show_test))),
    'health', jsonb_build_object(
      'last_push_run_at', v_push_at,
      'last_push_status', v_push_status,
      'push_failed_24h', (select count(*) from public.push_outbox o
        where o.outcome = 'failed' and o.created_at >= now() - interval '24 hours'
          and private.admin_ws_counts(o.workspace_id, p_show_test)),
      'old_builds', (select jsonb_build_object(
          'min_build', coalesce(v_min, 0),
          'people', count(*),
          'builds', coalesce(jsonb_agg(distinct b.build), '[]'::jsonb))
        from (select distinct on (d.user_id) d.user_id, d.app_build as build
              from public.push_devices d
              where d.app_build is not null
              order by d.user_id, d.updated_at desc) b
        where coalesce(v_min, 0) > 0 and b.build < v_min and private.admin_user_counts(b.user_id, p_show_test)))
  );
end;
$$;
revoke execute on function public.admin_owner_overview(boolean) from public, anon, authenticated;
grant execute on function public.admin_owner_overview(boolean) to authenticated;
