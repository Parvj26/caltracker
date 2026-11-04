-- Split names into first and last name on profiles and client_invites.
-- full_name stays as a generated column (first + ' ' + last) so existing reads keep working.
-- A generated column cannot be written, so writers now set first_name/last_name instead.

-- Split rule shared by the backfill and the sign-up trigger: the first word is the first name, everything after
-- the first run of spaces is the last name. Mirrors splitFullName() in packages/shared.
create function public.split_full_name(name text) returns text[]
language sql immutable set search_path = '' as $$
  select regexp_match(btrim(coalesce(name, '')), '^(\S*)\s*(.*)$');
$$;
revoke execute on function public.split_full_name(text) from public, anon, authenticated;

-- profiles
alter table public.profiles
  add column first_name text not null default '',
  add column last_name text not null default '';
update public.profiles
set first_name = (public.split_full_name(full_name))[1],
    last_name = (public.split_full_name(full_name))[2];
alter table public.profiles drop column full_name;
alter table public.profiles
  add column full_name text not null
  generated always as (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored;

-- The update(full_name) grant went with the old column; clients now rename themselves through first/last.
grant update (first_name, last_name) on public.profiles to authenticated;

-- client_invites (written only by the service role; authenticated keeps select/delete)
alter table public.client_invites
  add column first_name text not null default '',
  add column last_name text not null default '';
update public.client_invites
set first_name = (public.split_full_name(full_name))[1],
    last_name = (public.split_full_name(full_name))[2];
alter table public.client_invites drop column full_name;
alter table public.client_invites
  add column full_name text not null
  generated always as (btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))) stored;

-- Sign-up: read first_name/last_name from the auth metadata; older clients (and provision-coach before this
-- change) send a single full_name, which is split on the first space.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := btrim(coalesce(new.raw_user_meta_data ->> 'first_name', ''));
  v_last text := btrim(coalesce(new.raw_user_meta_data ->> 'last_name', ''));
  v_split text[];
begin
  if v_first = '' and v_last = '' then
    v_split := public.split_full_name(new.raw_user_meta_data ->> 'full_name');
    v_first := v_split[1];
    v_last := v_split[2];
  end if;
  insert into public.profiles (id, first_name, last_name)
  values (new.id, v_first, v_last);
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Invite preview: same as before, plus the split name. The return type changes, so drop and recreate.
drop function public.get_invite_preview(text);
create function public.get_invite_preview(token text)
returns table (
  status text, workspace_name text, email extensions.citext, full_name text, first_name text, last_name text
)
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
    f.ws_name, f.email, f.full_name, f.first_name, f.last_name
  from found f
  union all
  select 'not_found', null, null, null, null, null
  where not exists (select 1 from found);
$$;
revoke execute on function public.get_invite_preview(text) from public, anon, authenticated;
grant execute on function public.get_invite_preview(text) to anon, authenticated;
