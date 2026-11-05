import { supabase } from './supabase';

export type ClaimedWorkspace = { workspaceId: string; workspaceName: string };

/** Links the signed-in user to the coach who invited their email. Null when there is no valid invite. */
export async function claimWorkspace(): Promise<ClaimedWorkspace | null> {
  const { data, error } = await supabase.rpc('claim_invites');
  if (error) throw error;
  const row = data[0];
  return row ? { workspaceId: row.workspace_id, workspaceName: row.workspace_name } : null;
}

/** When a coach removed this client (and they haven't joined anyone since): that coach's business name, else null. */
export async function removedFrom(): Promise<string | null> {
  const { data, error } = await supabase.rpc('my_removal');
  if (error) return null; // Only changes the wording of the "ask your coach" screen, so never block on it.
  return data[0]?.workspace_name ?? null;
}

/**
 * The coach this client is linked to right now, read only: unlike claimWorkspace() it never joins anyone.
 * Used when the app returns to the foreground, so a removed client is never moved to another coach without
 * asking (joining happens at sign-in or when they tap "Check again").
 */
export async function currentWorkspace(): Promise<ClaimedWorkspace | null> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces(name)')
    .eq('role', 'client')
    .limit(1);
  if (error) throw error;
  const row = data[0];
  return row ? { workspaceId: row.workspace_id, workspaceName: row.workspaces?.name ?? '' } : null;
}
