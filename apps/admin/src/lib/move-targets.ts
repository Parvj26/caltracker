import { nameOr } from './admin-data';

type CoachRow = { user_id: string; name: string; workspace_id: string; workspace_name: string; role: string };

/**
 * The Move dialog's choices: one per workspace (admin_coaches has a row per coach per workspace, so staff would repeat
 * it), named after its owner, leaving out the client's current workspace. Sorted by label.
 */
export function moveTargets(rows: CoachRow[], currentWorkspaceId: string | null): Array<{ workspace_id: string; label: string }> {
  const byWorkspace = new Map<string, CoachRow>();
  for (const r of rows) {
    if (r.workspace_id === currentWorkspaceId) continue;
    const seen = byWorkspace.get(r.workspace_id);
    if (!seen || (seen.role !== 'owner' && r.role === 'owner')) byWorkspace.set(r.workspace_id, r);
  }
  return [...byWorkspace.values()]
    .map((r) => ({ workspace_id: r.workspace_id, label: `${nameOr(r.name)} · ${r.workspace_name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
