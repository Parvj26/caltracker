-- Admin dashboard, part 4: send-invite accepts admin callers ("Resend invite", "Move client", "Restore").
-- Spec: docs/superpowers/specs/2026-11-09-admin-dashboard-design.md
-- Plan: docs/superpowers/plans/2026-11-09-admin-dashboard.md (Task 4)
--
-- send-invite checks is_coach_of first; when the caller isn't a coach of the workspace it calls this with the caller's
-- JWT. True = support or higher at aal2 and the workspace exists, audited as resend_invite with the emails the
-- request names (target_user_id = that person when it names one email that has an account). Raises 42501 for
-- anyone else (send-invite answers 403); false for an unknown workspace.
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
  perform private.admin_audit('resend_invite',
    case when cardinality(v_emails) = 1 then (select u.id from auth.users u where lower(u.email) = v_emails[1]) end,
    jsonb_build_object('workspace_id', p_workspace_id, 'emails', to_jsonb(v_emails)));
  return true;
end;
$$;

revoke execute on function public.admin_can_invite(uuid, text[]) from public, anon, authenticated;
grant execute on function public.admin_can_invite(uuid, text[]) to authenticated;
