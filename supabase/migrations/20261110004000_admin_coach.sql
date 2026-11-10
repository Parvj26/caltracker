-- Admin dashboard: "Add coach" and "Delete coach" (owner only, two-step sign-in).
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md (PO decisions of 2026-11-10, decision A).
--
-- The admin site has no service-role key, so the privileged steps run in the admin-coach Edge Function:
--   1. it calls public.admin_require_owner() with the caller's JWT (owner + aal2, through private.admin_require);
--   2. create: public.admin_coach_email_status, then Supabase Auth's invite, then public.admin_create_coach;
--   3. delete: public.admin_coach_delete_preview (caller's JWT), its files through the Storage API
--      (public.admin_coach_delete_files), public.admin_delete_coach, then the auth accounts, then the clients' emails.
-- The service-role functions take the admin's id (the Edge Function read it from the verified JWT), check again that
-- it is an owner, and write the admin_audit_log row in the same transaction as the change.
--
-- Clients of a deleted workspace keep their accounts. Their membership goes with the workspace, and a
-- closed_workspace_clients row keeps their name and the workspace name (past_clients can't: it is keyed on the
-- workspace and goes with it). That row makes them a "removed" client everywhere a past client counts: the admin
-- Clients list ("No coach"), admin_can_invite (an admin can invite them to another coach) and my_removal (the phone
-- says "You're no longer connected to …"). Joining any workspace clears it, like past_clients.

-- 1. Clients whose workspace was deleted ----------------------------------------------------------------------------

create table public.closed_workspace_clients (
  -- Deleting the account (the in-app "delete my account") erases this record too.
  user_id uuid primary key references auth.users on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  workspace_name text not null,
  joined_at timestamptz,
  closed_at timestamptz not null default now()
);
create index closed_workspace_clients_email_idx on public.closed_workspace_clients (lower(email));
-- Read and written only by the security definer functions below.
revoke all on table public.closed_workspace_clients from public, anon, authenticated, service_role;
alter table public.closed_workspace_clients enable row level security;

create function private.clear_closed_workspace_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.closed_workspace_clients c where c.user_id = new.user_id;
  return new;
end;
$$;
revoke execute on function private.clear_closed_workspace_client() from public, anon, authenticated, service_role;
create trigger workspace_members_clear_closed_workspace_client
  after insert on public.workspace_members
  for each row execute function private.clear_closed_workspace_client();

-- 2. Private helpers ------------------------------------------------------------------------------------------------

-- For the service-role functions: there is no JWT, so the Edge Function passes the admin's id (from the verified JWT,
-- after admin_require_owner passed at aal2). Raises 42501 unless that id is an owner.
create function private.admin_require_owner_id(p_admin uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_admin is null or not exists (select 1 from public.admin_users a where a.user_id = p_admin and a.role = 'owner') then
    raise exception 'admin: not authorised' using errcode = '42501';
  end if;
end;
$$;

-- admin_audit with the admin's id passed in (auth.uid() is null for the service role).
create function private.admin_audit_as(p_admin uuid, p_action text, p_target uuid, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (p_admin, p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

-- What deleting the workspace removes: counts for the confirm dialog and the audit row.
-- workouts = the coach's library workouts (client copies and logs go too, as "all logs").
create function private.admin_workspace_counts(p_ws uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'clients', (select count(*) from public.workspace_members m where m.workspace_id = p_ws and m.role = 'client'),
    'staff', (select count(*) from public.workspace_members m where m.workspace_id = p_ws and m.role = 'staff'),
    'programs', (select count(*) from public.programs p where p.workspace_id = p_ws),
    'workouts', (select count(*) from public.workouts w where w.workspace_id = p_ws and w.client_id is null),
    'shared_meals', (select count(*) from public.coach_meals c where c.workspace_id = p_ws),
    'custom_exercises', (select count(*) from public.exercises e where e.workspace_id = p_ws),
    'logs', (select count(*) from public.workout_logs l where l.workspace_id = p_ws),
    'messages', (select count(*) from public.messages x where x.workspace_id = p_ws),
    'posts', (select count(*) from public.community_posts x where x.workspace_id = p_ws));
$$;

-- The coaches (owner and staff) whose accounts go with the workspace: those with no membership anywhere else.
-- A coach who also coaches (or trains) in another workspace keeps their account and only loses this membership.
create function private.admin_workspace_accounts_to_delete(p_ws uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.user_id order by m.role, m.created_at), '{}')
  from public.workspace_members m
  where m.workspace_id = p_ws and m.role in ('owner', 'staff')
    and not exists (select 1 from public.workspace_members o where o.user_id = m.user_id and o.workspace_id <> p_ws);
$$;

-- Why the workspace can't be deleted ('' when it can). p_admin is the caller.
create function private.admin_delete_coach_blocker(p_admin uuid, p_ws uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.workspace_members m where m.workspace_id = p_ws and m.user_id = p_admin)
      then 'You can''t delete a workspace you belong to.'
    when exists (select 1 from public.workspace_members m join public.admin_users a on a.user_id = m.user_id
                 where m.workspace_id = p_ws and m.role in ('owner', 'staff'))
      then 'A coach in this workspace is a CalTracker admin. Remove them on the Admins page first.'
    -- Workouts and logs refuse to lose an exercise (on delete restrict). Another workspace can't normally use this
    -- workspace's custom exercises; refuse clearly instead of failing on the foreign key if one ever does.
    when exists (select 1 from public.workout_exercises we join public.workout_blocks b on b.id = we.block_id
                 join public.workouts w on w.id = b.workout_id join public.exercises e on e.id = we.exercise_id
                 where e.workspace_id = p_ws and w.workspace_id <> p_ws)
      or exists (select 1 from public.log_exercises le join public.log_blocks b on b.id = le.block_id
                 join public.workout_logs l on l.id = b.log_id join public.exercises e on e.id = le.exercise_id
                 where e.workspace_id = p_ws and l.workspace_id <> p_ws)
      then 'Another workspace uses this coach''s custom exercises, so it can''t be deleted. Ask a developer.'
    else ''
  end;
$$;

revoke execute on function private.admin_require_owner_id(uuid), private.admin_audit_as(uuid, text, uuid, jsonb),
  private.admin_workspace_counts(uuid), private.admin_workspace_accounts_to_delete(uuid),
  private.admin_delete_coach_blocker(uuid, uuid)
  from public, anon, authenticated, service_role;

-- 3. Called with the admin's JWT ----------------------------------------------------------------------------------

-- The admin-coach Edge Function's first check: true for an owner at aal2, else 42501.
create function public.admin_require_owner() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('owner');
  return true;
end;
$$;

-- The Delete coach dialog: what goes, who keeps their account, and why it can't be deleted (blocker, '' = it can).
create function public.admin_coach_delete_preview(p_workspace_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_name text;
  v_owner uuid;
begin
  perform private.admin_require('owner');
  select w.name into v_name from public.workspaces w where w.id = p_workspace_id;
  if v_name is null then
    raise exception 'admin: no such workspace' using errcode = 'P0002';
  end if;
  select m.user_id into v_owner from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.role = 'owner' order by m.created_at limit 1;
  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace_name', v_name,
    'coach_id', v_owner,
    'coach_name', private.admin_name(v_owner),
    'counts', private.admin_workspace_counts(p_workspace_id),
    'delete_account_ids', to_jsonb(private.admin_workspace_accounts_to_delete(p_workspace_id)),
    'blocker', private.admin_delete_coach_blocker(auth.uid(), p_workspace_id));
end;
$$;

revoke execute on function public.admin_require_owner(), public.admin_coach_delete_preview(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_require_owner(), public.admin_coach_delete_preview(uuid) to authenticated;

-- 4. Service role only (the admin-coach Edge Function) ----------------------------------------------------------

-- Add coach, step 1: may this email become a new coach?
--   'new'    no account yet: go ahead;
--   'coach'  an owner or staff member of a workspace;
--   'admin'  a CalTracker admin;
--   'client' any other existing account (a client, past client, or someone who signed up): refused for now.
create function public.admin_coach_email_status(p_admin_id uuid, p_email text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  perform private.admin_require_owner_id(p_admin_id);
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    return 'new';
  elsif exists (select 1 from public.workspace_members m where m.user_id = v_user and m.role in ('owner', 'staff')) then
    return 'coach';
  elsif exists (select 1 from public.admin_users a where a.user_id = v_user) then
    return 'admin';
  end if;
  return 'client';
end;
$$;

-- Add coach, step 3 (after Supabase Auth created and invited the account): the workspace, its owner membership (which
-- also creates and joins its community, by trigger) and the add_coach audit row. The standard exercise library is
-- global (exercises with no workspace), so a new workspace sees it with nothing to copy. Returns the workspace id.
create function public.admin_create_coach(p_admin_id uuid, p_user_id uuid, p_workspace_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_workspace_name, ''));
  v_email text;
  v_ws uuid;
begin
  perform private.admin_require_owner_id(p_admin_id);
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'admin: workspace name must be 1 to 80 characters' using errcode = '22023';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'admin: no such account' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.workspace_members m where m.user_id = p_user_id) then
    raise exception 'admin: that account already belongs to a workspace' using errcode = '23505';
  end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'admin: that email belongs to a CalTracker admin' using errcode = '23505';
  end if;

  insert into public.workspaces (name) values (v_name) returning id into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (v_ws, p_user_id, 'owner');
  perform private.admin_audit_as(p_admin_id, 'add_coach', p_user_id,
    jsonb_build_object('workspace_id', v_ws, 'workspace_name', v_name, 'email', v_email));
  return v_ws;
end;
$$;

-- The files to remove before the delete: every object under the workspace's folder ({workspace}/...) in the buckets
-- that hold workspace files, plus everything of the accounts that will be deleted (their avatar and uploads; see
-- storage_objects_for_user). exercise-images holds only the global library (service role writes), so it isn't listed.
-- Works after the workspace is gone too (the second sweep).
create function public.admin_coach_delete_files(p_workspace_id uuid, p_user_ids uuid[] default '{}')
returns table (bucket_id text, name text)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('client-documents', 'scan-attachments', 'meal-photos', 'community-images', 'message-images',
                        'coach-meal-photos')
    and split_part(o.name, '/', 1) = p_workspace_id::text
  union
  select f.bucket_id, f.name
  from unnest(coalesce(p_user_ids, '{}')) as u(id)
  cross join lateral public.storage_objects_for_user(u.id) f
  order by 1, 2;
$$;

-- Delete coach (decision A). Checks the typed name and the blockers again, records the clients as closed-workspace
-- clients, writes the delete_coach audit row (kept: the log is append-only and has no foreign keys), then deletes the
-- workspace. Every table holding workspace data cascades from workspaces (supabase/tests/admin_coach.test.sql lists
-- them). The Edge Function then deletes delete_account_ids through Supabase Auth and emails the clients.
-- Returns { workspace_name, coach_name, delete_account_ids, clients: [{ user_id, email, first_name }] }.
create function public.admin_delete_coach(p_admin_id uuid, p_workspace_id uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_owner uuid;
  v_blocker text;
  v_counts jsonb;
  v_accounts uuid[];
  v_clients jsonb;
begin
  perform private.admin_require_owner_id(p_admin_id);
  select w.name into v_name from public.workspaces w where w.id = p_workspace_id for update;
  if v_name is null then
    raise exception 'admin: no such workspace' using errcode = 'P0002';
  end if;
  if p_confirm_name is distinct from v_name then
    raise exception 'admin: type the workspace name exactly to confirm' using errcode = '22023';
  end if;
  v_blocker := private.admin_delete_coach_blocker(p_admin_id, p_workspace_id);
  if v_blocker <> '' then
    raise exception 'admin: %', v_blocker using errcode = '55000';
  end if;
  -- No one joins or leaves while this runs.
  perform 1 from public.workspace_members m where m.workspace_id = p_workspace_id for update;

  select m.user_id into v_owner from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.role = 'owner' order by m.created_at limit 1;
  v_counts := private.admin_workspace_counts(p_workspace_id);
  v_accounts := private.admin_workspace_accounts_to_delete(p_workspace_id);

  insert into public.closed_workspace_clients (user_id, email, first_name, last_name, workspace_name, joined_at)
  select m.user_id, lower(btrim(u.email)), coalesce(p.first_name, ''), coalesce(p.last_name, ''), v_name, m.created_at
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id and m.role = 'client'
  on conflict (user_id) do update
    set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name,
        workspace_name = excluded.workspace_name, joined_at = excluded.joined_at, closed_at = now();

  select coalesce(jsonb_agg(jsonb_build_object('user_id', c.user_id, 'email', c.email, 'first_name', c.first_name)
           order by c.email), '[]'::jsonb)
  into v_clients
  from public.closed_workspace_clients c
  join public.workspace_members m on m.user_id = c.user_id and m.workspace_id = p_workspace_id and m.role = 'client';

  perform private.admin_audit_as(p_admin_id, 'delete_coach', v_owner, jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace_name', v_name,
    'coach_name', private.admin_name(v_owner),
    'counts', v_counts,
    'deleted_account_ids', to_jsonb(v_accounts),
    'client_ids', coalesce((select jsonb_agg(x -> 'user_id') from jsonb_array_elements(v_clients) x), '[]'::jsonb)));

  -- A system write: no Live Sync tombstones or "customised" marks for rows that are about to go.
  perform set_config('caltracker.system_write', 'on', true);
  delete from public.workspaces w where w.id = p_workspace_id;
  perform set_config('caltracker.system_write', '', true);

  return jsonb_build_object(
    'workspace_name', v_name,
    'coach_name', private.admin_name(v_owner),
    'delete_account_ids', to_jsonb(v_accounts),
    'clients', v_clients);
end;
$$;

revoke execute on function public.admin_coach_email_status(uuid, text), public.admin_create_coach(uuid, uuid, text),
  public.admin_coach_delete_files(uuid, uuid[]), public.admin_delete_coach(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_coach_email_status(uuid, text), public.admin_create_coach(uuid, uuid, text),
  public.admin_coach_delete_files(uuid, uuid[]), public.admin_delete_coach(uuid, uuid, text)
  to service_role;

-- 5. Closed-workspace clients count as removed clients ------------------------------------------------------------

-- As in 20261105000020_remove_client.sql, plus the closed-workspace record.
create or replace function public.my_removal()
returns table (workspace_name text, removed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.workspace_name, r.removed_at
  from (
    select w.name as workspace_name, pc.removed_at
    from public.past_clients pc
    join public.workspaces w on w.id = pc.workspace_id
    where pc.user_id = (select auth.uid())
    union all
    select c.workspace_name, c.closed_at
    from public.closed_workspace_clients c
    where c.user_id = (select auth.uid())
  ) r
  where not exists (
    select 1 from public.workspace_members m where m.user_id = (select auth.uid()) and m.role = 'client'
  )
  order by r.removed_at desc
  limit 1;
$$;

-- As in 20261109010100_admin_reads.sql, plus closed-workspace clients in "removed" (the Clients page's "No coach").
create or replace function public.admin_people()
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
    select r.user_id, 'client'::text as kind, null::text as coach_name
    from (select pc.user_id from public.past_clients pc
          union
          select c.user_id from public.closed_workspace_clients c) r
    where not exists (select 1 from public.workspace_members m where m.user_id = r.user_id and m.role = 'client')
  ), everyone as (
    select * from people union all select * from clients union all select * from removed
  )
  select e.user_id, e.kind, private.admin_name(e.user_id), private.admin_email_for(v_role, u.email::text), e.coach_name
  from everyone e join auth.users u on u.id = e.user_id
  order by 3, e.kind;
end;
$$;

-- As in 20261109010300_admin_invite_check.sql, plus closed-workspace clients: an admin can invite a client whose coach
-- was deleted to another coach, like a past client.
create or replace function public.admin_can_invite(p_workspace_id uuid, p_emails text[] default '{}') returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_emails text[];
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
        and not exists (select 1 from public.closed_workspace_clients c where lower(c.email) = e)
    )
  then
    return false;
  end if;
  perform private.admin_audit('resend_invite',
    case when cardinality(v_emails) = 1 then (select u.id from auth.users u where lower(u.email) = v_emails[1]) end,
    jsonb_build_object('workspace_id', p_workspace_id, 'emails', to_jsonb(v_emails)));
  return true;
end;
$$;

-- 6. The Coaches page needs each row's role (Delete coach is on the owner's row) ------------------------------------

-- As in 20261109010100_admin_reads.sql, plus role. The return type changes, so drop and create.
drop function public.admin_coaches();
create function public.admin_coaches()
returns table (user_id uuid, name text, workspace_id uuid, workspace_name text, created_at timestamptz, clients integer,
  last_active timestamptz, programs_assigned_7d integer, messages_7d integer, health text, role public.member_role)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('readonly');
  return query
  select x.user_id, x.name, x.workspace_id, x.workspace_name, x.created_at, x.clients, x.last_active,
    x.programs_assigned_7d, x.messages_7d, private.admin_coach_health(x.last_active), x.role
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
         and msg.created_at >= now() - interval '7 days') as messages_7d,
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
