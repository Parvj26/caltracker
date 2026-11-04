create extension if not exists pgtap with schema extensions;

create type public.member_role as enum ('owner', 'staff', 'client');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  units text not null default 'kg' check (units in ('kg', 'lb')),
  avatar_path text,
  created_at timestamptz default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  badge_style text not null default 'animals' check (badge_style in ('animals', 'plain')),
  created_at timestamptz default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null,
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- A client belongs to exactly one workspace.
create unique index one_workspace_per_client
  on public.workspace_members (user_id) where role = 'client';
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Auto-create a profile for every new auth user.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Tenancy helpers (bypass RLS so policies can use them without recursion).
create function public.is_coach_of(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
      and m.role in ('owner', 'staff')
  );
$$;

create function public.is_member_of(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

-- True when the current user shares a workspace with the given user.
create function public.shares_workspace_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.workspace_members me
    join public.workspace_members them on them.workspace_id = me.workspace_id
    where me.user_id = (select auth.uid()) and them.user_id = other
  );
$$;

revoke execute on function public.is_coach_of(uuid), public.is_member_of(uuid),
  public.shares_workspace_with(uuid) from public, anon;
grant execute on function public.is_coach_of(uuid), public.is_member_of(uuid),
  public.shares_workspace_with(uuid) to authenticated;

-- Privileges (identical locally and hosted): least privilege, nothing for anon.
revoke all on table public.profiles, public.workspaces, public.workspace_members
  from anon, authenticated;
grant select on public.profiles, public.workspaces, public.workspace_members to authenticated;
grant update (full_name, units, avatar_path) on public.profiles to authenticated;
grant update (name, badge_style) on public.workspaces to authenticated;

-- RLS
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_workspace_with(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.is_member_of(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_coach_of(id)) with check (public.is_coach_of(id));

-- Memberships are created only by claim_invites() and provision-coach (no write policies).
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_coach_of(workspace_id));
