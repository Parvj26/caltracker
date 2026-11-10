-- Admin dashboard, part 1: roles, the audit log and admin management.
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md
-- Plan: docs/superpowers/plans/2026-11-09-admin-dashboard.md (Task 1)
--
-- The admin site reads and writes only through public.admin_* security definer functions. Each one first calls
-- private.admin_require(min_role), which needs an admin_users row with that role or higher AND a two-step (aal2)
-- session. Functions that change data write one admin_audit_log row in the same transaction.
-- Bootstrap: the first owner is a plain SQL insert (docs/runbooks/admin.md), never a migration.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Declaration order is the rank: readonly < support < owner.
create type public.admin_role as enum ('readonly', 'support', 'owner');

-- 1. Tables (RLS on, no policies: access only through the functions) -----------------------------------------------

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.admin_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
revoke all on table public.admin_users from anon, authenticated, service_role;
grant select on public.admin_users to service_role;
alter table public.admin_users enable row level security;

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- Kept when the admin's account is deleted: the log is the record.
  admin_id uuid not null,
  action text not null,
  target_user_id uuid,
  details jsonb not null default '{}'
);
create index admin_audit_log_admin_idx on public.admin_audit_log (admin_id, id desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_user_id, id desc);
revoke all on table public.admin_audit_log from anon, authenticated, service_role;
grant select on public.admin_audit_log to service_role;
alter table public.admin_audit_log enable row level security;

create function private.admin_audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'admin: audit log is append-only';
end;
$$;
create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function private.admin_audit_append_only();
create trigger admin_audit_log_no_truncate
  before truncate on public.admin_audit_log
  for each statement execute function private.admin_audit_append_only();

-- 2. Private helpers --------------------------------------------------------------------------------------------------

-- The caller's role. Raises 42501 'admin: not authorised' unless they are an admin with at least p_min and signed in
-- with two-step (JWT aal = aal2).
create function private.admin_require(p_min public.admin_role) returns public.admin_role
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
begin
  select a.role into v_role from public.admin_users a where a.user_id = auth.uid();
  if v_role is null or v_role < p_min or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'admin: not authorised' using errcode = '42501';
  end if;
  return v_role;
end;
$$;

create function private.admin_audit(p_action text, p_target uuid, p_details jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (auth.uid(), p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

-- 'parv@gmail.com' -> 'pa…@gmail.com'.
create function private.admin_mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_email is null then null
    when position('@' in p_email) = 0 then left(p_email, 2) || '…'
    else left(split_part(p_email, '@', 1), 2) || '…@' || substr(p_email, position('@' in p_email) + 1)
  end;
$$;

-- The email as p_role may see it: masked for readonly.
create function private.admin_email_for(p_role public.admin_role, p_email text) returns text
language sql immutable set search_path = '' as $$
  select case when p_role = 'readonly' then private.admin_mask_email(p_email) else p_email end;
$$;

-- Raises unless at least one owner would remain. Locks the owner rows so two owners can't both step down at once.
create function private.admin_keep_an_owner() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.admin_users a where a.role = 'owner' for update;
  if not exists (select 1 from public.admin_users a where a.role = 'owner') then
    raise exception 'admin: at least one owner is required';
  end if;
end;
$$;

revoke execute on function private.admin_require(public.admin_role), private.admin_audit(text, uuid, jsonb),
  private.admin_mask_email(text), private.admin_email_for(public.admin_role, text), private.admin_keep_an_owner(),
  private.admin_audit_append_only()
  from public, anon, authenticated, service_role;

-- 3. Public functions -------------------------------------------------------------------------------------------------

-- Needs only a signed-in session (aal1): the sign-in page uses it to choose between "Not authorised" and the two-step
-- screen. No rows for a non-admin.
create function public.admin_me()
returns table (role public.admin_role, email text)
language sql stable security definer set search_path = '' as $$
  select a.role, u.email::text
  from public.admin_users a
  join auth.users u on u.id = a.user_id
  where a.user_id = auth.uid();
$$;

create function public.admin_list_admins()
returns table (user_id uuid, email text, first_name text, last_name text, role public.admin_role, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.admin_require('owner');
  return query
    select a.user_id, u.email::text, coalesce(p.first_name, ''), coalesce(p.last_name, ''), a.role, a.created_at
    from public.admin_users a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    order by a.role desc, u.email;
end;
$$;

-- Adds an admin or changes their role, by account email (any case). Returns their user id.
create function public.admin_set_admin(p_email text, p_role public.admin_role) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_email text;
  v_previous public.admin_role;
begin
  perform private.admin_require('owner');
  if p_role is null then
    raise exception 'admin: role is required' using errcode = '22023';
  end if;

  select u.id, u.email into v_user, v_email from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'admin: no account with that email' using errcode = 'P0002';
  end if;

  select a.role into v_previous from public.admin_users a where a.user_id = v_user for update;
  insert into public.admin_users (user_id, role, created_by)
  values (v_user, p_role, auth.uid())
  on conflict (user_id) do update set role = excluded.role;
  if v_previous = 'owner' and p_role <> 'owner' then
    perform private.admin_keep_an_owner();
  end if;

  perform private.admin_audit('set_admin', v_user,
    jsonb_build_object('email', v_email, 'role', p_role, 'previous_role', v_previous));
  return v_user;
end;
$$;

create function public.admin_remove_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.admin_role;
begin
  perform private.admin_require('owner');
  delete from public.admin_users a where a.user_id = p_user_id returning a.role into v_role;
  if v_role is null then
    raise exception 'admin: not an admin' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    perform private.admin_keep_an_owner();
  end if;
  perform private.admin_audit('remove_admin', p_user_id, jsonb_build_object('role', v_role));
end;
$$;

revoke execute on function public.admin_me(), public.admin_list_admins(), public.admin_set_admin(text, public.admin_role),
  public.admin_remove_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_me(), public.admin_list_admins(), public.admin_set_admin(text, public.admin_role),
  public.admin_remove_admin(uuid)
  to authenticated;
