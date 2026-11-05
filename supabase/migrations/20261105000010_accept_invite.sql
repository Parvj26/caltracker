-- Join from the invite link (docs/superpowers/specs/2026-11-05-invite-join-design.md).
-- The accept-invite Edge Function (service role) uses these two functions; nobody else can call them.

-- Describes the invite behind a raw token, plus any existing account with the invited email, so the
-- function can decide between "create the account", "confirm the unconfirmed account" and "sign in instead".
create function public.invite_for_join(token text)
returns table (
  invite_id uuid,
  status text,
  email text,
  first_name text,
  last_name text,
  workspace_id uuid,
  workspace_name text,
  user_id uuid,
  user_confirmed boolean,
  user_is_coach boolean
)
language sql stable security definer set search_path = '' as $$
  with found as (
    select i.*, w.name as ws_name
    from public.client_invites i
    join public.workspaces w on w.id = i.workspace_id
    where i.token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
  ),
  account as (
    select u.id, u.email_confirmed_at is not null as confirmed
    from auth.users u, found f
    where lower(trim(u.email)) = f.email::text
    limit 1
  )
  select
    f.id,
    case
      when f.accepted_at is not null then 'used'
      when f.expires_at <= now() then 'expired'
      else 'valid'
    end,
    f.email::text, f.first_name, f.last_name, f.workspace_id, f.ws_name,
    a.id,
    coalesce(a.confirmed, false),
    exists (
      select 1 from public.workspace_members m
      where m.user_id = a.id and m.role in ('owner', 'staff')
    )
  from found f
  left join account a on true
  union all
  select null, 'not_found', null, null, null, null, null, null, false, false
  where not exists (select 1 from found);
$$;

-- Links a confirmed account to the workspace that invited its email and marks the invite used, in one
-- transaction. Re-checks everything under a row lock, so two taps on Join can never both succeed.
-- Returns 'ok' or why not: not_found | used | expired | email_unconfirmed | email_mismatch | coach_account | other_coach.
create function public.accept_invite_for(p_invite_id uuid, p_user_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  inv public.client_invites%rowtype;
  v_email text;
  v_confirmed boolean;
  v_client_of uuid;
begin
  select * into inv from public.client_invites i where i.id = p_invite_id for update;
  if not found then
    return 'not_found';
  end if;
  if inv.accepted_at is not null then
    return 'used';
  end if;
  if inv.expires_at <= now() then
    return 'expired';
  end if;

  select lower(trim(u.email)), u.email_confirmed_at is not null into v_email, v_confirmed
  from auth.users u where u.id = p_user_id;
  if v_email is null or v_email <> inv.email::text then
    return 'email_mismatch';
  end if;
  if not v_confirmed then
    return 'email_unconfirmed';
  end if;

  -- Same lock as claim_invites(), so the two paths never race for one user.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if exists (
    select 1 from public.workspace_members m
    where m.user_id = p_user_id and m.role in ('owner', 'staff')
  ) then
    return 'coach_account';
  end if;

  select m.workspace_id into v_client_of
  from public.workspace_members m
  where m.user_id = p_user_id and m.role = 'client';
  if v_client_of is not null and v_client_of <> inv.workspace_id then
    return 'other_coach';
  end if;
  if v_client_of is null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, p_user_id, 'client');
  end if;

  -- Same as claim_invites(): every open invite for this email in this workspace is now used.
  update public.client_invites i
  set accepted_at = now(), accepted_by = p_user_id
  where i.workspace_id = inv.workspace_id and i.email = inv.email and i.accepted_at is null;

  return 'ok';
end;
$$;

revoke execute on function public.invite_for_join(text), public.accept_invite_for(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.invite_for_join(text), public.accept_invite_for(uuid, uuid) to service_role;
