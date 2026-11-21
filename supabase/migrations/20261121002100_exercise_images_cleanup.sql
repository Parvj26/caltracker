-- Deleting a coach's workspace also removes the photos of its own exercises (exercise-images, custom/<workspace>/...),
-- which coaches can upload since 20261121002000. Same function as before (admin_coach_delete_files, called by the
-- admin-coach Edge Function with the service role), with that one folder added. Built-in pictures are never listed.

create or replace function public.admin_coach_delete_files(p_workspace_id uuid, p_user_ids uuid[] default '{}')
returns table (bucket_id text, name text)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('client-documents', 'scan-attachments', 'meal-photos', 'community-images', 'message-images',
                        'coach-meal-photos')
    and split_part(o.name, '/', 1) = p_workspace_id::text
  union
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = 'exercise-images'
    and split_part(o.name, '/', 1) = 'custom'
    and split_part(o.name, '/', 2) = p_workspace_id::text
  union
  select f.bucket_id, f.name
  from unnest(coalesce(p_user_ids, '{}')) as u(id)
  cross join lateral public.storage_objects_for_user(u.id) f
  order by 1, 2;
$$;
comment on function public.admin_coach_delete_files(uuid, uuid[]) is
  'Files to remove before deleting a workspace: its folder ({workspace}/...) in the buckets holding workspace files, '
  'its own exercise photos (exercise-images/custom/{workspace}/...), and every file of the accounts being deleted.';
revoke execute on function public.admin_coach_delete_files(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.admin_coach_delete_files(uuid, uuid[]) to service_role;
