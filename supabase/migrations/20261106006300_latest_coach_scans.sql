-- Each client's latest coach-entered body scan date in a workspace, one row per client, for the coach home's
-- "Body scans 30+ days" group (instead of reading every scan). Security invoker: body_measurements' RLS decides
-- what the caller sees, so another workspace's coach gets nothing and a client gets at most their own row.
create function public.latest_coach_scans(p_workspace_id uuid)
returns table (client_id uuid, measured_on date)
language sql stable security invoker set search_path = '' as $$
  select distinct on (m.client_id) m.client_id, m.measured_on
  from public.body_measurements m
  where m.workspace_id = p_workspace_id and m.source = 'coach'
  order by m.client_id, m.measured_on desc;
$$;
revoke execute on function public.latest_coach_scans(uuid) from public, anon;
grant execute on function public.latest_coach_scans(uuid) to authenticated;
