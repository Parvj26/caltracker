-- The phone app's first-time screen says "Meet your coach" with the coach's name.
-- A client can already read the profiles of people in their workspace, but cannot see the membership rows
-- that say who the owner is, so this returns the owner's name only (no id, email or anything else).
-- It answers only about the caller: a current client gets their coach; anyone else (coach, staff,
-- removed client) gets no row.
create function public.get_my_coach()
returns table (coach_name text)
language sql stable security definer set search_path = '' as $$
  select p.full_name
  from public.workspace_members me
  join public.workspace_members owner on owner.workspace_id = me.workspace_id and owner.role = 'owner'
  join public.profiles p on p.id = owner.user_id
  where me.user_id = (select auth.uid()) and me.role = 'client'
  limit 1;
$$;

revoke execute on function public.get_my_coach() from public, anon, authenticated;
grant execute on function public.get_my_coach() to authenticated;

-- Units: profiles.units is already updatable by its owner (column grant in 20261103000100_core.sql and the
-- profiles_update_own policy), so no grant change is needed here. Tested in my_coach_and_units.test.sql.
