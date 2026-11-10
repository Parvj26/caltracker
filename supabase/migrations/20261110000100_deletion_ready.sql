-- Account deletion (Apple requires it in the app; plan docs/superpowers/plans/2026-11-06-go-live.md, Task 2).
-- The delete-account Edge Function removes the client's files through the Storage API, then deletes the auth user.
-- This migration makes that delete erase every row about the person, and gives the function two read-only helpers.
-- supabase/tests/deletion_ready.test.sql keeps a reviewed list of every user column and bucket, so a new table or
-- bucket that would survive a deletion fails the tests.

-- 1. Foreign keys that blocked or outlived a deletion -------------------------------------------------------------

-- Invites hold the client's name and email: the accepted invite goes with the client's account. An invite belongs to
-- the workspace, not to the coach who sent it: deleting a coach (dashboard or script) keeps every invite they sent,
-- other clients' accepted and pending ones and their plans, with the sender cleared.
alter table public.client_invites
  drop constraint client_invites_accepted_by_fkey,
  add constraint client_invites_accepted_by_fkey foreign key (accepted_by) references auth.users on delete cascade,
  alter column created_by drop not null,
  drop constraint client_invites_created_by_fkey,
  add constraint client_invites_created_by_fkey foreign key (created_by) references auth.users on delete set null;
create index if not exists client_invites_accepted_by_idx on public.client_invites (accepted_by);
create index if not exists client_invites_created_by_idx on public.client_invites (created_by);

-- Reports copy the reported words and name their author and reporter. Both kinds are the person's data, so a
-- report filed by them or about them is erased with their account (it used to stay with the ids cleared).
alter table public.community_reports
  drop constraint community_reports_reporter_id_fkey,
  add constraint community_reports_reporter_id_fkey foreign key (reporter_id) references auth.users on delete cascade,
  drop constraint community_reports_target_author_id_fkey,
  add constraint community_reports_target_author_id_fkey foreign key (target_author_id)
    references auth.users on delete cascade;

-- 2. Rows that mention the person without a foreign key ----------------------------------------------------------

-- Runs inside the auth delete, so every path (the app, support, the dashboard) erases the same things:
--   * every invite sent to their address (older expired or replaced ones are not linked by accepted_by);
--   * notifications to other people that carry their id and first name (e.g. "Sam reacted to your post").
create function private.erase_account_leftovers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email is not null then
    delete from public.client_invites i where i.email = old.email::extensions.citext;
  end if;
  delete from public.push_outbox o where o.data ->> 'actorId' = old.id::text;
  return old;
end;
$$;
revoke execute on function private.erase_account_leftovers() from public, anon, authenticated, service_role;
create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function private.erase_account_leftovers();

-- 3. Files to remove before the auth delete ----------------------------------------------------------------------

-- Every stored file of the person, whoever uploaded it (a coach's InBody PDF or photo in the client's thread goes
-- too, because the folder is the client's). Read only: the Edge Function removes them with the Storage API.
--   avatars           {user}/...
--   client-documents  {workspace}/{client}/...
--   scan-attachments  {workspace}/{client}/...
--   meal-photos       {workspace}/{client}/...
--   community-images  {workspace}/{author}/{post}/...
--   message-images    {workspace}/{conversation}/... for every conversation of the client
--   any bucket        objects the person uploaded (owner)
-- coach-meal-photos and exercise-images hold only a coach's library, so they are reached through owner alone.
create function public.storage_objects_for_user(p_user uuid) returns table (bucket_id text, name text)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name
  from storage.objects o
  where (o.bucket_id = 'avatars' and split_part(o.name, '/', 1) = p_user::text)
     or (o.bucket_id in ('client-documents', 'scan-attachments', 'meal-photos', 'community-images')
         and split_part(o.name, '/', 2) = p_user::text)
     or (o.bucket_id = 'message-images'
         and split_part(o.name, '/', 2) in (select c.id::text from public.conversations c where c.client_id = p_user))
     or o.owner_id = p_user::text
     or o.owner = p_user
  order by o.bucket_id, o.name;
$$;
revoke execute on function public.storage_objects_for_user(uuid) from public, anon, authenticated;
grant execute on function public.storage_objects_for_user(uuid) to service_role;

-- 4. What the Edge Function needs before the data is gone ---------------------------------------------------------

-- One row: whether the person coaches (owner or staff anywhere: coaches close their account by email instead), their
-- name, and their current coach's email and first name for the "your client deleted their account" email.
create function public.account_deletion_info(p_user uuid)
returns table (is_coach boolean, client_name text, coach_email text, coach_first_name text, workspace_name text)
language sql stable security definer set search_path = '' as $$
  select
    exists (select 1 from public.workspace_members m where m.user_id = p_user and m.role in ('owner', 'staff')),
    coalesce(nullif(btrim(p.full_name), ''), ''),
    u.email::text,
    coalesce(nullif(btrim(op.first_name), ''), nullif(btrim(op.full_name), ''), ''),
    w.name
  from (select p_user as id) me
  left join public.profiles p on p.id = me.id
  left join public.workspace_members cm on cm.user_id = me.id and cm.role = 'client'
  left join public.workspaces w on w.id = cm.workspace_id
  left join lateral (
    select om.user_id from public.workspace_members om
    where om.workspace_id = cm.workspace_id and om.role = 'owner'
    order by om.created_at limit 1
  ) owner on true
  left join auth.users u on u.id = owner.user_id
  left join public.profiles op on op.id = owner.user_id;
$$;
revoke execute on function public.account_deletion_info(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_info(uuid) to service_role;
