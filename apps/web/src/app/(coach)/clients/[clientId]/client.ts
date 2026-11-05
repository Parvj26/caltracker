import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A current client of the coach's workspace, or null (not a uuid, not a member, a coach or staff member, or a
 * removed client). The workspace comes from requireCoach(), never from the browser.
 */
export async function loadClient(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
): Promise<{ id: string; name: string } | null> {
  if (!UUID.test(clientId)) return null;
  const { data: member, error } = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', clientId)
    .eq('role', 'client')
    .maybeSingle();
  if (error) throw new Error(`Could not load the client: ${error.message}`);
  if (!member) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', clientId)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load the client's name: ${profileError.message}`);
  return { id: clientId, name: profile?.full_name || 'Client' };
}
