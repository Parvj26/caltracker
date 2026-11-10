-- Admin dashboard, part 2: read functions for the Overview, Coaches, Clients and Logs pages.
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md
-- Plan: docs/superpowers/plans/2026-11-09-admin-dashboard.md (Task 2)
--
-- All need the readonly role or higher (admin_audit needs support). Every email returned goes through
-- private.admin_email_for, which masks it for readonly callers. Weeks start on Monday, in UTC.

-- 1. Private helpers --------------------------------------------------------------------------------------------------

-- A person's display name ('' when unknown).
create function private.admin_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(p.full_name), '') from public.profiles p where p.id = p_user), '');
$$;

-- When a coach last did coaching work: assigned a program, sent a message or logged a client's workout.
-- p_ws null = in any workspace.
create function private.admin_coach_last_active(p_user uuid, p_ws uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select max(pa.created_at) from public.program_assignments pa
     where pa.created_by = p_user and (p_ws is null or pa.workspace_id = p_ws)),
    (select max(m.created_at) from public.messages m
     where m.sender_id = p_user and (p_ws is null or m.workspace_id = p_ws)),
    (select max(l.created_at) from public.workout_logs l
     where l.logged_by = p_user and l.client_id <> p_user and (p_ws is null or l.workspace_id = p_ws))
  );
$$;

-- 'good' = active within 3 days, 'quiet' = within 14 days, else 'inactive'.
create function private.admin_coach_health(p_last_active timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p_last_active >= now() - interval '3 days' then 'good'
    when p_last_active >= now() - interval '14 days' then 'quiet'
    else 'inactive'
  end;
$$;

-- Notifications are on when the user has a device and hasn't switched every type off.
create function private.admin_notifications_on(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.push_devices d where d.user_id = p_user)
    and not exists (
      select 1 from public.notification_prefs np
      where np.user_id = p_user and np.disabled @> array[
        'workout_assigned', 'workout_changed', 'daily_reminder', 'coach_logged', 'still_training', 'message',
        'workout_comment', 'meal_comment', 'food_targets', 'community_coach_post', 'community_activity'
      ]::text[]
    );
$$;

-- The Monday 00:00 UTC that starts this week.
create function private.admin_week_start() returns timestamptz
language sql stable set search_path = '' as $$
  select date_trunc('week', now() at time zone 'utc') at time zone 'utc';
$$;

revoke execute on function private.admin_name(uuid), private.admin_coach_last_active(uuid, uuid),
  private.admin_coach_health(timestamptz), private.admin_notifications_on(uuid), private.admin_week_start()
  from public, anon, authenticated, service_role;

-- 2. Overview ---------------------------------------------------------------------------------------------------------

create function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week timestamptz;
  v_coaches jsonb;
  v_clients jsonb;
  v_push_at timestamptz;
  v_push_status text;
begin
  perform private.admin_require('readonly');
  v_week := private.admin_week_start();

  select jsonb_build_object(
      'total', count(*),
      'active7', count(*) filter (where c.last_active >= now() - interval '7 days'),
      'new7', count(*) filter (where c.joined >= now() - interval '7 days'))
    into v_coaches
  from (
    select m.user_id, min(m.created_at) as joined, private.admin_coach_last_active(m.user_id, null) as last_active
    from public.workspace_members m where m.role in ('owner', 'staff') group by m.user_id
  ) c;

  select jsonb_build_object(
      'total', count(*),
      'active7', count(*) filter (where
        exists (select 1 from public.workout_logs l where l.client_id = c.user_id and l.started_at >= now() - interval '7 days')
        or exists (select 1 from public.meals ml where ml.client_id = c.user_id and ml.created_at >= now() - interval '7 days')),
      'new7', count(*) filter (where c.joined >= now() - interval '7 days'))
    into v_clients
  from (
    select m.user_id, min(m.created_at) as joined
    from public.workspace_members m where m.role = 'client' group by m.user_id
  ) c;

  select d.start_time, d.status into v_push_at, v_push_status
  from cron.job_run_details d join cron.job j on j.jobid = d.jobid
  where j.jobname = 'push-send'
  order by d.start_time desc
  limit 1;

  return jsonb_build_object(
    'coaches', v_coaches,
    'clients', v_clients,
    'workouts', (select jsonb_build_object(
        'this_week', count(*) filter (where l.finished_at >= v_week),
        'last_week', count(*) filter (where l.finished_at >= v_week - interval '7 days' and l.finished_at < v_week))
      from public.workout_logs l
      where l.status = 'completed' and l.finished_at >= v_week - interval '7 days'),
    'meals', (select jsonb_build_object(
        'this_week', count(*) filter (where ml.eaten_at >= v_week),
        'last_week', count(*) filter (where ml.eaten_at >= v_week - interval '7 days' and ml.eaten_at < v_week))
      from public.meals ml
      where ml.eaten_at >= v_week - interval '7 days'),
    'system', jsonb_build_object(
      'last_push_run_at', v_push_at,
      'last_push_status', v_push_status,
      'push_failed_24h', (select count(*) from public.push_outbox o
        where o.outcome = 'failed' and o.created_at >= now() - interval '24 hours'),
      'invites_sent_today', (select count(*) from public.client_invites i
        where i.sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
      'app_versions', coalesce((
        select jsonb_agg(jsonb_build_object('version', x.version, 'devices', x.devices) order by x.devices desc, x.version)
        from (select coalesce(d.app_version, 'unknown') as version, count(*) as devices
              from public.push_devices d group by 1) x), '[]'::jsonb)
    )
  );
end;
$$;

-- 3. Needs attention --------------------------------------------------------------------------------------------------

-- invite_id is set for invite_expired rows (the Resend button needs the invite); null otherwise.
create function public.admin_needs_attention()
returns table (kind text, user_id uuid, name text, since timestamptz, action text, invite_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('readonly');
  return query
  with clients as (
    select m.user_id, min(m.created_at) as joined
    from public.workspace_members m where m.role = 'client' group by m.user_id
  ), coaches as (
    select m.user_id, min(m.created_at) as joined, private.admin_coach_last_active(m.user_id, null) as last_active
    from public.workspace_members m where m.role in ('owner', 'staff') group by m.user_id
  ), items as (
    select 'invite_expired'::text as kind,
      (select u.id from auth.users u where lower(u.email) = lower(i.email::text)) as user_id,
      i.full_name as name, i.expires_at as since, 'resend_invite'::text as action, i.id as invite_id
    from public.client_invites i
    where i.accepted_at is null and i.expires_at < now()
    union all
    select 'no_signin_7d', c.user_id, private.admin_name(c.user_id), coalesce(u.last_sign_in_at, c.joined), 'open', null
    from clients c join auth.users u on u.id = c.user_id
    where coalesce(u.last_sign_in_at, c.joined) < now() - interval '7 days'
    union all
    select 'notifications_off', c.user_id, private.admin_name(c.user_id), c.joined, 'open', null
    from clients c
    where not private.admin_notifications_on(c.user_id)
    union all
    select 'push_failed', o.user_id, private.admin_name(o.user_id), min(o.created_at), 'open', null
    from public.push_outbox o
    where o.outcome = 'failed' and o.created_at >= now() - interval '24 hours'
    group by o.user_id
    union all
    select 'coach_inactive_14d', c.user_id, private.admin_name(c.user_id), coalesce(c.last_active, c.joined), 'open', null
    from coaches c
    where coalesce(c.last_active, c.joined) < now() - interval '14 days'
    union all
    select 'coach_no_meals', m.user_id, private.admin_name(m.user_id), m.created_at, 'open', null
    from public.workspace_members m
    where m.role = 'owner'
      and not exists (select 1 from public.coach_meals cm where cm.workspace_id = m.workspace_id and cm.deleted_at is null)
  )
  select r.kind, r.user_id, r.name, r.since, r.action, r.invite_id from items r
  order by r.since, r.kind, r.user_id;
end;
$$;

-- 4. People (the smart-search source) ---------------------------------------------------------------------------------

-- Coaches, current clients (with their coach) and removed clients (no coach).
create function public.admin_people()
returns table (user_id uuid, kind text, name text, email text, coach_name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
begin
  v_role := private.admin_require('readonly');
  return query
  with people as (
    select distinct on (m.user_id) m.user_id, 'coach'::text as kind, null::text as coach_name
    from public.workspace_members m where m.role in ('owner', 'staff')
    order by m.user_id
  ), clients as (
    select distinct on (m.user_id) m.user_id, 'client'::text as kind,
      (select private.admin_name(o.user_id) from public.workspace_members o
       where o.workspace_id = m.workspace_id and o.role = 'owner' limit 1) as coach_name
    from public.workspace_members m where m.role = 'client'
    order by m.user_id, m.created_at desc
  ), removed as (
    select distinct pc.user_id, 'client'::text as kind, null::text as coach_name
    from public.past_clients pc
    where not exists (select 1 from public.workspace_members m where m.user_id = pc.user_id and m.role = 'client')
  ), everyone as (
    select * from people union all select * from clients union all select * from removed
  )
  select e.user_id, e.kind, private.admin_name(e.user_id), private.admin_email_for(v_role, u.email::text), e.coach_name
  from everyone e join auth.users u on u.id = e.user_id
  order by 3, e.kind;
end;
$$;

-- 5. Coaches ----------------------------------------------------------------------------------------------------------

-- One row per coach per workspace they coach in.
create function public.admin_coaches()
returns table (user_id uuid, name text, workspace_id uuid, workspace_name text, created_at timestamptz, clients integer,
  last_active timestamptz, programs_assigned_7d integer, messages_7d integer, health text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('readonly');
  return query
  select x.user_id, x.name, x.workspace_id, x.workspace_name, x.created_at, x.clients, x.last_active,
    x.programs_assigned_7d, x.messages_7d, private.admin_coach_health(x.last_active)
  from (
    select m.user_id, private.admin_name(m.user_id) as name, m.workspace_id, w.name as workspace_name, m.created_at,
      (select count(*)::integer from public.workspace_members c
       where c.workspace_id = m.workspace_id and c.role = 'client') as clients,
      private.admin_coach_last_active(m.user_id, m.workspace_id) as last_active,
      (select count(*)::integer from public.program_assignments pa
       where pa.workspace_id = m.workspace_id and pa.created_by = m.user_id
         and pa.created_at >= now() - interval '7 days') as programs_assigned_7d,
      (select count(*)::integer from public.messages msg
       where msg.workspace_id = m.workspace_id and msg.sender_id = m.user_id
         and msg.created_at >= now() - interval '7 days') as messages_7d
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.role in ('owner', 'staff')
  ) x
  order by x.name, x.workspace_name;
end;
$$;

-- A coach's summary across the workspaces they coach in. The median reply time counts, over 30 days, the gap between a
-- client's first message after the coach last spoke and this coach's next message in that conversation.
create function public.admin_coach(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ws uuid[];
begin
  perform private.admin_require('readonly');
  select array_agg(m.workspace_id) into v_ws
  from public.workspace_members m where m.user_id = p_user_id and m.role in ('owner', 'staff');
  if v_ws is null then
    raise exception 'admin: not a coach' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'name', private.admin_name(p_user_id),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', c.user_id, 'name', c.name) order by c.name, c.user_id)
      from (select distinct m.user_id, private.admin_name(m.user_id) as name
            from public.workspace_members m where m.workspace_id = any (v_ws) and m.role = 'client') c), '[]'::jsonb),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'weeks', p.weeks) order by p.name, p.id)
      from public.programs p where p.workspace_id = any (v_ws)), '[]'::jsonb),
    'meals_shared', (select count(*) from public.coach_meals cm where cm.workspace_id = any (v_ws) and cm.deleted_at is null),
    'median_reply_minutes_30d', (
      with msgs as (
        select m.conversation_id, m.created_at, m.sender_id = c.client_id as from_client,
          lag(m.sender_id = c.client_id) over (partition by m.conversation_id order by m.created_at, m.id) as prev_from_client
        from public.messages m join public.conversations c on c.id = m.conversation_id
        where c.workspace_id = any (v_ws) and m.created_at >= now() - interval '30 days'
      ), gaps as (
        select extract(epoch from (
          select min(r.created_at) from public.messages r
          where r.conversation_id = s.conversation_id and r.sender_id = p_user_id and r.created_at > s.created_at
        ) - s.created_at) / 60 as minutes
        from msgs s
        where s.from_client and s.prev_from_client is distinct from true
      )
      select round(percentile_cont(0.5) within group (order by g.minutes))::integer from gaps g where g.minutes is not null
    )
  );
end;
$$;

-- 6. Client page ------------------------------------------------------------------------------------------------------

-- removed: the latest past_clients record when they currently have no coach (for "Restore"), else null.
create function public.admin_client(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
  v_user auth.users%rowtype;
  v_member public.workspace_members%rowtype;
begin
  v_role := private.admin_require('readonly');
  select * into v_user from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'admin: no such user' using errcode = 'P0002';
  end if;
  select * into v_member from public.workspace_members m
  where m.user_id = p_user_id and m.role = 'client'
  order by m.created_at desc limit 1;

  return jsonb_build_object(
    'user_id', p_user_id,
    'name', private.admin_name(p_user_id),
    'email', private.admin_email_for(v_role, v_user.email::text),
    'workspace_id', v_member.workspace_id,
    'coach', (
      select jsonb_build_object('user_id', o.user_id, 'name', private.admin_name(o.user_id))
      from public.workspace_members o
      where o.workspace_id = v_member.workspace_id and o.role = 'owner'
      limit 1),
    'joined_at', v_member.created_at,
    'email_confirmed', v_user.email_confirmed_at is not null,
    'last_sign_in_at', v_user.last_sign_in_at,
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('app_version', d.app_version, 'last_seen_at', d.updated_at) order by d.updated_at desc)
      from public.push_devices d where d.user_id = p_user_id), '[]'::jsonb),
    'notifications_on', private.admin_notifications_on(p_user_id),
    'last_sync_at', greatest(
      (select max(l.updated_at) from public.workout_logs l where l.client_id = p_user_id),
      (select max(ml.updated_at) from public.meals ml where ml.client_id = p_user_id),
      (select max(d.updated_at) from public.push_devices d where d.user_id = p_user_id)),
    'push_errors', coalesce((
      select jsonb_agg(jsonb_build_object('at', o.created_at, 'type', o.type, 'error', o.last_error) order by o.created_at desc)
      from public.push_outbox o
      where o.user_id = p_user_id and o.last_error is not null and o.created_at >= now() - interval '7 days'), '[]'::jsonb),
    'removed', case when v_member.user_id is null then (
      select jsonb_build_object('workspace_id', pc.workspace_id, 'workspace_name', w.name, 'removed_at', pc.removed_at,
        'email', private.admin_email_for(v_role, pc.email), 'first_name', pc.first_name, 'last_name', pc.last_name)
      from public.past_clients pc join public.workspaces w on w.id = pc.workspace_id
      where pc.user_id = p_user_id
      order by pc.removed_at desc limit 1) end
  );
end;
$$;

-- 7. Logs -------------------------------------------------------------------------------------------------------------

create function public.admin_push_log(p_user_id uuid default null, p_limit integer default 100)
returns table (id uuid, at timestamptz, user_id uuid, name text, type text, outcome text, attempts integer,
  last_error text, sent_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('readonly');
  return query
  select o.id, o.created_at, o.user_id, private.admin_name(o.user_id), o.type, o.outcome, o.attempts, o.last_error, o.sent_at
  from public.push_outbox o
  where p_user_id is null or o.user_id = p_user_id
  order by o.created_at desc, o.id
  limit least(greatest(coalesce(p_limit, 100), 0), 1000);
end;
$$;

-- status is pending | expired | accepted. ('cancelled' never appears: cancelling deletes the invite, as on the coach
-- side.) p_user_id matches invites sent to that user's email or accepted by them.
create function public.admin_invite_log(p_user_id uuid default null, p_limit integer default 100)
returns table (id uuid, email text, workspace_id uuid, workspace_name text, first_name text, last_name text,
  created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
  v_email text;
begin
  v_role := private.admin_require('readonly');
  if p_user_id is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  end if;
  return query
  select i.id, private.admin_email_for(v_role, i.email::text), i.workspace_id, w.name, i.first_name, i.last_name,
    i.created_at, i.expires_at, i.accepted_at,
    case when i.accepted_at is not null then 'accepted' when i.expires_at < now() then 'expired' else 'pending' end
  from public.client_invites i
  join public.workspaces w on w.id = i.workspace_id
  where p_user_id is null or i.accepted_by = p_user_id or lower(i.email::text) = v_email
  order by i.created_at desc, i.id
  limit least(greatest(coalesce(p_limit, 100), 0), 1000);
end;
$$;

-- Owner: every row. Support: only their own. Readonly: denied.
create function public.admin_audit(p_limit integer default 200)
returns table (id bigint, at timestamptz, admin_id uuid, admin_name text, action text, target_user_id uuid,
  target_name text, details jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
begin
  v_role := private.admin_require('support');
  return query
  select a.id, a.at, a.admin_id, private.admin_name(a.admin_id), a.action, a.target_user_id,
    case when a.target_user_id is null then null else private.admin_name(a.target_user_id) end, a.details
  from public.admin_audit_log a
  where v_role = 'owner' or a.admin_id = auth.uid()
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 200), 0), 1000);
end;
$$;

revoke execute on function public.admin_overview(), public.admin_needs_attention(), public.admin_people(),
  public.admin_coaches(), public.admin_coach(uuid), public.admin_client(uuid), public.admin_push_log(uuid, integer),
  public.admin_invite_log(uuid, integer), public.admin_audit(integer)
  from public, anon, authenticated;
grant execute on function public.admin_overview(), public.admin_needs_attention(), public.admin_people(),
  public.admin_coaches(), public.admin_coach(uuid), public.admin_client(uuid), public.admin_push_log(uuid, integer),
  public.admin_invite_log(uuid, integer), public.admin_audit(integer)
  to authenticated;
