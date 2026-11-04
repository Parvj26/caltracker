-- Explicit service_role table privileges. Hosted projects with "auto-expose new tables" turned off
-- do not grant these by default, which would break send-invite, provision-coach and import-exercises.
-- Revoke first so the privilege set is the same everywhere (local and hosted).
revoke all on table
  public.profiles, public.workspaces, public.workspace_members,
  public.client_invites, public.exercises, public.exercise_overrides
  from service_role;
grant select, insert, update, delete on table
  public.profiles, public.workspaces, public.workspace_members,
  public.client_invites, public.exercises, public.exercise_overrides
  to service_role;

-- All client_invites writes go through the service role (send-invite Edge Function), so coaches
-- keep read and delete access only. Their insert/update policies are now unreachable: drop them.
drop policy client_invites_insert on public.client_invites;
drop policy client_invites_update on public.client_invites;
revoke insert, update on public.client_invites from authenticated;
