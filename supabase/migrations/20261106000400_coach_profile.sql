-- Coach profile: a short bio, a profile photo (private bucket), and an owner-only business rename.

alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 300),
  add column updated_at timestamptz default now();

-- The photo path must live in the user's own folder (or be unset).
alter table public.profiles add constraint profiles_avatar_path_own_folder
  check (avatar_path is null or avatar_path like id::text || '/%');

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Everyone can already edit their own profile row; add the bio to what they may change.
-- Reading: profiles_select already lets a client read the profiles of people in their workspace (their coach
-- included) and nobody else's, so no policy change is needed. Tested in coach_profile.test.sql.
grant update (bio) on public.profiles to authenticated;

-- Renaming the business is for the owner only (staff coaches may not), so it goes through a function and the
-- direct column update is withdrawn. badge_style stays directly updatable by coaches.
revoke update (name) on public.workspaces from authenticated;

create function public.update_workspace_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_ws uuid;
begin
  select m.workspace_id into v_ws
  from public.workspace_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner'
  order by m.created_at
  limit 1; -- an owner owns exactly one workspace; the order only makes the pick deterministic
  if v_ws is null then
    raise exception 'only the owner can rename the business' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'business name must be 1 to 80 characters' using errcode = '23514';
  end if;
  update public.workspaces set name = v_name where id = v_ws;
end;
$$;

revoke execute on function public.update_workspace_name(text) from public, anon, authenticated;
grant execute on function public.update_workspace_name(text) to authenticated;

-- Private avatars bucket. Paths are {user_id}/avatar.webp and {user_id}/avatar-thumb.webp.
-- A user writes only their own folder; reads cover their own folder and people in their workspace.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict do nothing;

create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_select_workspace on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (
        (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and public.shares_workspace_with(((storage.foldername(name))[1])::uuid)
      )
    )
  );
