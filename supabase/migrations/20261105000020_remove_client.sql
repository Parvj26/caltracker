-- Remove client (docs/superpowers/specs/2026-11-04-remove-client-design.md).
-- Removing deletes the membership, so every existing access check (is_member_of, shares_workspace_with, RLS)
-- ends access at once with no changes. History rows key on (workspace_id, client_id), not on the membership,
-- so they stay; past_clients keeps the name and email for the coach's "Past clients" list.

create table public.past_clients (
  workspace_id uuid not null references public.workspaces on delete cascade,
  -- Deleting the account (the in-app "delete my account") erases this record too.
  user_id uuid not null references auth.users on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  full_name text generated always as (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored,
  joined_at timestamptz,
  removed_at timestamptz not null default now(),
  removed_by uuid references auth.users on delete set null,
  primary key (workspace_id, user_id)
);

revoke all on table public.past_clients from anon, authenticated;
grant select on public.past_clients to authenticated;
grant select, insert, update, delete on public.past_clients to service_role;

alter table public.past_clients enable row level security;
create policy past_clients_select on public.past_clients for select to authenticated
  using (public.is_coach_of(workspace_id));

-- Coach (owner or staff) removes a client. Raises 42501 for anyone else, P0002 when they aren't a client here.
create function public.remove_client(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.workspace_members%rowtype;
begin
  if not public.is_coach_of(p_workspace_id) then
    raise exception 'Only a coach of this workspace can remove clients' using errcode = '42501';
  end if;

  select * into m from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role = 'client'
  for update;
  if not found then
    raise exception 'Not a client of this workspace' using errcode = 'P0002';
  end if;

  insert into public.past_clients (workspace_id, user_id, email, first_name, last_name, joined_at, removed_by)
  select p_workspace_id, p_user_id, lower(trim(u.email)), coalesce(p.first_name, ''), coalesce(p.last_name, ''),
    m.created_at, (select auth.uid())
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id
  on conflict (workspace_id, user_id) do update
    set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name,
        joined_at = excluded.joined_at, removed_at = now(), removed_by = excluded.removed_by;

  delete from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id and wm.role = 'client';
end;
$$;

-- The phone app asks this after claim_invites() finds no coach, to say "You're no longer connected to {name}".
create function public.my_removal()
returns table (workspace_name text, removed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select w.name, pc.removed_at
  from public.past_clients pc
  join public.workspaces w on w.id = pc.workspace_id
  where pc.user_id = (select auth.uid())
    and not exists (
      select 1 from public.workspace_members m where m.user_id = pc.user_id and m.role = 'client'
    )
  order by pc.removed_at desc
  limit 1;
$$;

-- Re-joining (claim_invites, accept_invite_for, or anything else that adds the membership) clears the record,
-- so the client reappears in the list with their history.
create function public.clear_past_client() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.past_clients pc where pc.workspace_id = new.workspace_id and pc.user_id = new.user_id;
  return new;
end;
$$;

create trigger workspace_members_clear_past_client
  after insert on public.workspace_members
  for each row execute function public.clear_past_client();

revoke execute on function public.remove_client(uuid, uuid), public.my_removal(), public.clear_past_client()
  from public, anon, authenticated;
grant execute on function public.remove_client(uuid, uuid), public.my_removal() to authenticated;

-- Cancel invite only ever deletes pending invites; an accepted one is the client's history (remove them instead).
alter policy client_invites_delete on public.client_invites
  using (public.is_coach_of(workspace_id) and accepted_at is null);
