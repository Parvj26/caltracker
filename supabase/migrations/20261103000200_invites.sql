create extension if not exists citext with schema extensions;

create table public.client_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email extensions.citext not null,
  full_name text not null,
  -- Only the SHA-256 hex hash is stored; the raw token exists only in the email link.
  token_hash text not null unique,
  -- Server-controlled: coaches cannot write these (see grants); 14-day expiry.
  expires_at timestamptz not null default now() + interval '14 days',
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users,
  created_by uuid not null references auth.users,
  created_at timestamptz default now(),
  constraint client_invites_expiry_window
    check (expires_at > sent_at and expires_at <= sent_at + interval '14 days')
);

create unique index one_open_invite
  on public.client_invites (workspace_id, email) where accepted_at is null;
create index client_invites_email_idx on public.client_invites (email) where accepted_at is null;

-- Normalise the email so claim_invites() can match on it.
create function public.normalize_invite_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.email := lower(trim(new.email::text));
  return new;
end;
$$;

create trigger client_invites_normalize_email
  before insert or update of email on public.client_invites
  for each row execute function public.normalize_invite_email();

-- Privileges: coaches manage invites through RLS; acceptance fields are written
-- only by claim_invites() and the service role.
revoke all on table public.client_invites from anon, authenticated;
grant select, delete on public.client_invites to authenticated;
grant insert (workspace_id, email, full_name, token_hash, created_by)
  on public.client_invites to authenticated;
grant update (email, full_name, token_hash)
  on public.client_invites to authenticated;

alter table public.client_invites enable row level security;

create policy client_invites_select on public.client_invites for select to authenticated
  using (public.is_coach_of(workspace_id));
create policy client_invites_insert on public.client_invites for insert to authenticated
  with check (public.is_coach_of(workspace_id) and created_by = (select auth.uid()));
create policy client_invites_update on public.client_invites for update to authenticated
  using (public.is_coach_of(workspace_id)) with check (public.is_coach_of(workspace_id));
create policy client_invites_delete on public.client_invites for delete to authenticated
  using (public.is_coach_of(workspace_id));

-- Links the calling (email-confirmed) user to the coach workspace that invited them.
create function public.claim_invites()
returns table (workspace_id uuid, workspace_name text)
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_email text;
  v_ws uuid;
  v_invite uuid;
begin
  if uid is null then
    return;
  end if;

  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = uid and u.email_confirmed_at is not null;
  if v_email is null then
    return;
  end if;

  -- Serialise concurrent calls for the same user.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Coaches are never linked as clients.
  if exists (
    select 1 from public.workspace_members m
    where m.user_id = uid and m.role in ('owner', 'staff')
  ) then
    return;
  end if;

  select m.workspace_id into v_ws
  from public.workspace_members m
  where m.user_id = uid and m.role = 'client';

  if v_ws is null then
    select i.id, i.workspace_id into v_invite, v_ws
    from public.client_invites i
    where i.accepted_at is null and i.expires_at > now() and i.email = v_email
    order by i.sent_at desc, i.id
    limit 1
    for update;

    if v_ws is null then
      return;
    end if;

    begin
      insert into public.workspace_members (workspace_id, user_id, role)
      values (v_ws, uid, 'client');
    exception when unique_violation then
      -- Lost a race: keep the membership that already exists.
      select m.workspace_id into v_ws
      from public.workspace_members m
      where m.user_id = uid and m.role = 'client';
    end;
  end if;

  update public.client_invites i
  set accepted_at = now(), accepted_by = uid
  where i.workspace_id = v_ws and i.email = v_email and i.accepted_at is null;

  return query
    select w.id, w.name from public.workspaces w where w.id = v_ws;
end;
$$;

-- Public invite page: describes an invite to whoever holds the raw token.
create function public.get_invite_preview(token text)
returns table (status text, workspace_name text, email extensions.citext, full_name text)
language sql stable security definer set search_path = '' as $$
  with found as (
    select i.*, w.name as ws_name
    from public.client_invites i
    join public.workspaces w on w.id = i.workspace_id
    where i.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
  )
  select
    case
      when f.accepted_at is not null then 'accepted'
      when f.expires_at <= now() then 'expired'
      else 'valid'
    end,
    f.ws_name, f.email, f.full_name
  from found f
  union all
  select 'not_found', null, null, null
  where not exists (select 1 from found);
$$;

revoke execute on function public.claim_invites(), public.get_invite_preview(text),
  public.normalize_invite_email() from public, anon, authenticated;
grant execute on function public.claim_invites() to authenticated;
grant execute on function public.get_invite_preview(text) to anon, authenticated;
