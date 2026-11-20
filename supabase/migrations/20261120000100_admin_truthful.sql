-- Admin site: make the existing pages truthful.
--
-- 1. Last active (private.admin_coach_last_active) also counts the coach's sign-in sessions, workouts they built and
--    invites they sent (not invites an admin sent from their workspace). Health uses whole days: Active (<= 3 days),
--    Going quiet (4-13), Inactive (14+).
-- 2. Coaches "This week" (Monday 00:00 UTC on) counts workouts built and programs assigned, not programs and messages.
-- 3. The client page: "Last sync" no longer counts push-token refreshes; "Recent errors" lists delivery problems
--    (no phone, expired, failed), not just pushes with an error message.
-- 4. Move to another coach removes the client from the one coach named in the dialog (admin_move_client) and is one
--    audit row: the invite that follows (send-invite -> admin_can_invite) is not logged again.
-- 5. admin_people also lists accounts with no coach and no past-client record (kind 'account'), and gives each
--    client's coach id so the Clients page groups by coach, not by name.

-- For Last active's invite check (admin audit rows for a workspace just before an invite).
create index admin_audit_log_action_at_idx on public.admin_audit_log (action, at);

-- 1. Last active and health ---------------------------------------------------------------------------------------

-- When a coach last did coaching work, or used the app or website: their latest session refresh, a workout they built,
-- an invite they sent, a program they assigned, a message they sent, or a workout they logged for a client.
-- p_ws null = in any workspace (sessions are not tied to a workspace). Invites an admin sent from the coach's workspace
-- are made in the owner's name, so they are skipped: an admin audit row for that workspace just before the invite.
create or replace function private.admin_coach_last_active(p_user uuid, p_ws uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select max(greatest(s.refreshed_at at time zone 'utc', s.updated_at)) from auth.sessions s where s.user_id = p_user),
    (select max(w.created_at) from public.workouts w
     where w.created_by = p_user and (p_ws is null or w.workspace_id = p_ws)),
    (select max(i.created_at) from public.client_invites i
     where i.created_by = p_user and (p_ws is null or i.workspace_id = p_ws)
       and not exists (
         select 1 from public.admin_audit_log a
         where a.action in ('resend_invite', 'move_client')
           and coalesce(a.details ->> 'workspace_id', a.details ->> 'to_workspace_id') = i.workspace_id::text
           and a.at between i.created_at - interval '2 minutes' and i.created_at)),
    (select max(pa.created_at) from public.program_assignments pa
     where pa.created_by = p_user and (p_ws is null or pa.workspace_id = p_ws)),
    (select max(m.created_at) from public.messages m
     where m.sender_id = p_user and (p_ws is null or m.workspace_id = p_ws)),
    (select max(l.created_at) from public.workout_logs l
     where l.logged_by = p_user and l.client_id <> p_user and (p_ws is null or l.workspace_id = p_ws))
  );
$$;

-- 'good' = Active (0-3 whole days ago), 'quiet' = Going quiet (4-13), 'inactive' = 14+ days or never.
create or replace function private.admin_coach_health(p_last_active timestamptz) returns text
language sql stable set search_path = '' as $$
  select case
    when p_last_active is null then 'inactive'
    when extract(epoch from now() - p_last_active) < 4 * 86400 then 'good'
    when extract(epoch from now() - p_last_active) < 14 * 86400 then 'quiet'
    else 'inactive'
  end;
$$;

revoke execute on function private.admin_coach_last_active(uuid, uuid), private.admin_coach_health(timestamptz)
  from public, anon, authenticated, service_role;

-- 2. Coaches: this week = workouts built + programs assigned since Monday 00:00 UTC ---------------------------------

-- As in 20261110004000_admin_coach.sql, with workouts_built_week and programs_assigned_week in place of
-- programs_assigned_7d and messages_7d. "Built" = a workout the coach made by hand (library or one-off), not the
-- copies an assignment makes. The return type changes, so drop and create.
drop function public.admin_coaches();
create function public.admin_coaches()
returns table (user_id uuid, name text, workspace_id uuid, workspace_name text, created_at timestamptz, clients integer,
  last_active timestamptz, workouts_built_week integer, programs_assigned_week integer, health text,
  role public.member_role)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week timestamptz;
begin
  perform private.admin_require('readonly');
  v_week := private.admin_week_start();
  return query
  select x.user_id, x.name, x.workspace_id, x.workspace_name, x.created_at, x.clients, x.last_active,
    x.workouts_built_week, x.programs_assigned_week, private.admin_coach_health(x.last_active), x.role
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
      m.role
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.role in ('owner', 'staff')
  ) x
  order by x.name, x.workspace_name;
end;
$$;
revoke execute on function public.admin_coaches() from public, anon, authenticated;
grant execute on function public.admin_coaches() to authenticated;

-- 3. Client page --------------------------------------------------------------------------------------------------

-- As in 20261109010100_admin_reads.sql, except:
--   last_sync_at: the client's own activity: workout logs they logged (last_activity_at, which coach corrections and the
--     hourly auto-finish job leave alone, unlike updated_at), meals and body metrics they entered; not push-token
--     refreshes;
--   push_errors: the last 7 days' pushes that did not reach the phone: outcome no_device, expired or failed
--     ({at, type, outcome, error}; error is the sender's message for failed ones, else null).
create or replace function public.admin_client(p_user_id uuid) returns jsonb
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
      (select max(l.last_activity_at) from public.workout_logs l
       where l.client_id = p_user_id and l.logged_by = l.client_id),
      (select max(ml.updated_at) from public.meals ml where ml.client_id = p_user_id),
      (select max(bm.updated_at) from public.body_metrics bm
       where bm.client_id = p_user_id and bm.entered_by_role = 'client')),
    'push_errors', coalesce((
      select jsonb_agg(jsonb_build_object('at', o.created_at, 'type', o.type, 'outcome', o.outcome,
          'error', case when o.outcome = 'failed' then o.last_error end) order by o.created_at desc)
      from public.push_outbox o
      where o.user_id = p_user_id and o.outcome in ('no_device', 'expired', 'failed')
        and o.created_at >= now() - interval '7 days'), '[]'::jsonb),
    'removed', case when v_member.user_id is null then (
      select jsonb_build_object('workspace_id', pc.workspace_id, 'workspace_name', w.name, 'removed_at', pc.removed_at,
        'email', private.admin_email_for(v_role, pc.email), 'first_name', pc.first_name, 'last_name', pc.last_name)
      from public.past_clients pc join public.workspaces w on w.id = pc.workspace_id
      where pc.user_id = p_user_id
      order by pc.removed_at desc limit 1) end
  );
end;
$$;

-- 4. Move to another coach ----------------------------------------------------------------------------------------

-- A move in progress: the invite admin_can_invite should not audit again (the move_client row covers it). One row per
-- move, used once. Private: only these functions touch it.
create table private.admin_pending_moves (
  admin_id uuid not null,
  user_id uuid not null,
  workspace_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (admin_id, user_id, workspace_id)
);
alter table private.admin_pending_moves enable row level security;
revoke all on table private.admin_pending_moves from public, anon, authenticated, service_role;

-- Removes the client from p_from_workspace_id only (exactly as that coach would, removed_by = its owner) and writes one
-- move_client audit row. The admin site then sends the invite to p_to_workspace_id through send-invite.
create function public.admin_move_client(p_user_id uuid, p_from_workspace_id uuid, p_to_workspace_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_require('support');
  if p_from_workspace_id = p_to_workspace_id then
    raise exception 'admin: pick a different coach' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_to_workspace_id) then
    raise exception 'admin: no such coach' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_from_workspace_id and m.user_id = p_user_id and m.role = 'client') then
    raise exception 'admin: not a client of that coach' using errcode = 'P0002';
  end if;
  perform private.remove_client_core(p_from_workspace_id, p_user_id,
    (select o.user_id from public.workspace_members o where o.workspace_id = p_from_workspace_id and o.role = 'owner' limit 1));
  delete from private.admin_pending_moves pm where pm.created_at < now() - interval '1 hour';
  insert into private.admin_pending_moves (admin_id, user_id, workspace_id)
  values (auth.uid(), p_user_id, p_to_workspace_id)
  on conflict (admin_id, user_id, workspace_id) do update set created_at = now();
  perform private.admin_audit('move_client', p_user_id, jsonb_build_object(
    'from_workspace_id', p_from_workspace_id, 'to_workspace_id', p_to_workspace_id,
    'from_workspace_name', (select w.name from public.workspaces w where w.id = p_from_workspace_id),
    'to_workspace_name', (select w.name from public.workspaces w where w.id = p_to_workspace_id)));
end;
$$;
revoke execute on function public.admin_move_client(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_move_client(uuid, uuid, uuid) to authenticated;

-- Deprecated: replaced by admin_move_client (it removes the client from every coach, though the dialog names one).
-- Kept for one release: the admin site deployed before this migration still calls it from Move until the new site is
-- deployed. Drop it in a later migration.
comment on function public.admin_remove_client(uuid) is
  'Deprecated (20261120000100): use admin_move_client. Kept for the deploy window; drop in a later migration.';

-- As in 20261110004000_admin_coach.sql, except a single-email invite that finishes a move (admin_move_client, in the
-- last 10 minutes, by this admin, to this workspace) is not audited again: the move_client row is the record.
create or replace function public.admin_can_invite(p_workspace_id uuid, p_emails text[] default '{}') returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_emails text[];
  v_target uuid;
  v_moved boolean := false;
begin
  perform private.admin_require('support');
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return false;
  end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_emails
  from unnest(coalesce(p_emails, '{}')) e where btrim(e) <> '';
  if cardinality(v_emails) = 0
    or exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = any (v_emails))
    or exists (
      select 1 from unnest(v_emails) e
      where not exists (select 1 from public.client_invites i where lower(i.email::text) = e)
        and not exists (select 1 from public.past_clients pc where lower(pc.email) = e)
        and not exists (select 1 from public.closed_workspace_clients c join auth.users u on u.id = c.user_id
                        where lower(u.email) = e)
    )
  then
    return false;
  end if;
  if cardinality(v_emails) = 1 then
    select u.id into v_target from auth.users u where lower(u.email) = v_emails[1];
  end if;
  if v_target is not null then
    with used as (
      delete from private.admin_pending_moves pm
      where pm.admin_id = auth.uid() and pm.user_id = v_target and pm.workspace_id = p_workspace_id
        and pm.created_at >= now() - interval '10 minutes'
      returning 1)
    select exists (select 1 from used) into v_moved;
  end if;
  if not v_moved then
    perform private.admin_audit('resend_invite', v_target,
      jsonb_build_object('workspace_id', p_workspace_id, 'emails', to_jsonb(v_emails)));
  end if;
  return true;
end;
$$;

-- 5. People ---------------------------------------------------------------------------------------------------------

-- As in 20261110004000_admin_coach.sql, plus:
--   coach_id: a current client's coach (their workspace's owner), so the Clients page groups by coach, not by name;
--   kind 'account': anyone else with an account (never a client, no past-client record, not a coach), so search finds them.
-- The return type changes, so drop and create.
drop function public.admin_people();
create function public.admin_people()
returns table (user_id uuid, kind text, name text, email text, coach_name text, coach_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
begin
  v_role := private.admin_require('readonly');
  return query
  with people as (
    select distinct on (m.user_id) m.user_id, 'coach'::text as kind, null::uuid as coach_id
    from public.workspace_members m where m.role in ('owner', 'staff')
    order by m.user_id
  ), clients as (
    select distinct on (m.user_id) m.user_id, 'client'::text as kind,
      (select o.user_id from public.workspace_members o
       where o.workspace_id = m.workspace_id and o.role = 'owner' limit 1) as coach_id
    from public.workspace_members m where m.role = 'client'
    order by m.user_id, m.created_at desc
  ), removed as (
    select r.user_id, 'client'::text as kind, null::uuid as coach_id
    from (select pc.user_id from public.past_clients pc
          union
          select c.user_id from public.closed_workspace_clients c) r
    where not exists (select 1 from public.workspace_members m where m.user_id = r.user_id and m.role = 'client')
  ), known as (
    select * from people union all select * from clients union all select * from removed
  ), accounts as (
    select u.id as user_id, 'account'::text as kind, null::uuid as coach_id
    from auth.users u
    where not exists (select 1 from known k where k.user_id = u.id)
  ), everyone as (
    select * from known union all select * from accounts
  )
  select e.user_id, e.kind, private.admin_name(e.user_id), private.admin_email_for(v_role, u.email::text),
    case when e.coach_id is null then null else private.admin_name(e.coach_id) end, e.coach_id
  from everyone e join auth.users u on u.id = e.user_id
  order by 3, e.kind;
end;
$$;
revoke execute on function public.admin_people() from public, anon, authenticated;
grant execute on function public.admin_people() to authenticated;
