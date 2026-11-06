-- The phone app shows the coach's photo, name, business and bio. A client cannot see the membership rows that say
-- who the owner is, so (like get_my_coach) this finds the owner for them and returns only what the card needs.
-- It answers only about the caller: a current client gets their coach; anyone else gets no row.
create function public.get_my_coach_profile()
returns table (coach_name text, business_name text, bio text, avatar_path text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.full_name, w.name, p.bio, p.avatar_path, p.updated_at
  from public.workspace_members me
  join public.workspace_members owner on owner.workspace_id = me.workspace_id and owner.role = 'owner'
  join public.profiles p on p.id = owner.user_id
  join public.workspaces w on w.id = me.workspace_id
  where me.user_id = (select auth.uid()) and me.role = 'client'
  limit 1;
$$;

revoke execute on function public.get_my_coach_profile() from public, anon, authenticated;
grant execute on function public.get_my_coach_profile() to authenticated;
