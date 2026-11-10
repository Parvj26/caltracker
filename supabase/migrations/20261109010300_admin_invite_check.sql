-- Admin dashboard, part 4: send-invite accepts admin callers ("Resend invite", "Move client", "Restore").
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md
-- Plan: docs/superpowers/plans/2026-11-09-admin-dashboard.md (Task 4)
--
-- send-invite checks is_coach_of first; when the caller isn't a coach of the workspace it calls this with the caller's
-- JWT. Raises 42501 unless support or higher at aal2 (send-invite answers 403).
-- True only when the workspace exists and every email is someone already in the system: an invite in any workspace
-- (Resend) or a past client (Move runs admin_remove_client first; Restore). Never the caller's own email, and never an
-- empty list. True is audited as resend_invite with the emails (target_user_id = that person when there is one email
-- with an account); false writes nothing.
create function public.admin_can_invite(p_workspace_id uuid, p_emails text[] default '{}') returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_emails text[];
begin
  perform private.admin_require('support');
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    return false;
  end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_emails
  from unnest(coalesce(p_emails, '{}')) e where btrim(e) <> '';
  if cardinality(v_emails) = 0
    or exists (select 1 from auth.users u where u.id = auth.uid() and lower(u.email) = any (v_emails))
    or exists (
      select 1 from unnest(v_emails) e
      where not exists (select 1 from public.client_invites i where lower(i.email::text) = e)
        and not exists (select 1 from public.past_clients pc where lower(pc.email) = e)
    )
  then
    return false;
  end if;
  perform private.admin_audit('resend_invite',
    case when cardinality(v_emails) = 1 then (select u.id from auth.users u where lower(u.email) = v_emails[1]) end,
    jsonb_build_object('workspace_id', p_workspace_id, 'emails', to_jsonb(v_emails)));
  return true;
end;
$$;

revoke execute on function public.admin_can_invite(uuid, text[]) from public, anon, authenticated;
grant execute on function public.admin_can_invite(uuid, text[]) to authenticated;
