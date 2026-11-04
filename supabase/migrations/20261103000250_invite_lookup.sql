-- Used only by the send-invite Edge Function (service role) to classify invite
-- recipients: which of these emails already belong to a workspace, and as what.
create function public.lookup_members_by_email(emails text[])
returns table (email text, user_id uuid, role public.member_role, workspace_id uuid)
language sql stable security definer set search_path = '' as $$
  select lower(trim(u.email)), u.id, m.role, m.workspace_id
  from auth.users u
  join public.workspace_members m on m.user_id = u.id
  where lower(trim(u.email)) = any (select lower(trim(e)) from unnest(emails) as e);
$$;

revoke execute on function public.lookup_members_by_email(text[]) from public, anon, authenticated;
grant execute on function public.lookup_members_by_email(text[]) to service_role;
