import { supabase } from './supabase';

export type ClaimedWorkspace = { workspaceId: string; workspaceName: string };

/** Links the signed-in user to the coach who invited their email. Null when there is no valid invite. */
export async function claimWorkspace(): Promise<ClaimedWorkspace | null> {
  const { data, error } = await supabase.rpc('claim_invites');
  if (error) throw error;
  const row = data[0];
  return row ? { workspaceId: row.workspace_id, workspaceName: row.workspace_name } : null;
}
