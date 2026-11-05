import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A client of the workspace. `firstName` falls back to the full name when they have none. `removedAt` is set for a
 * past client (removed; their history stays readable).
 */
export type ClientRef = { id: string; name: string; firstName: string; removedAt: string | null };

/**
 * A current or past client of the coach's workspace, or null: not a uuid, a coach or staff member, or someone who
 * was never a client here. The workspace comes from requireCoach(), never from the browser.
 */
export async function loadClient(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
): Promise<ClientRef | null> {
  if (!UUID.test(clientId)) return null;
  const [member, past] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', clientId)
      .eq('role', 'client')
      .maybeSingle(),
    supabase
      .from('past_clients')
      .select('full_name, first_name, email, removed_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', clientId)
      .maybeSingle(),
  ]);
  if (member.error) throw new Error(`Could not load the client: ${member.error.message}`);
  if (past.error) throw new Error(`Could not load the client: ${past.error.message}`);

  if (member.data) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('full_name, first_name')
      .eq('id', clientId)
      .maybeSingle();
    if (error) throw new Error(`Could not load the client's name: ${error.message}`);
    const name = profile?.full_name || 'Client';
    return { id: clientId, name, firstName: profile?.first_name || name, removedAt: null };
  }
  // A removed client's profile is no longer visible to the coach; past_clients kept their name and email.
  if (past.data) {
    const name = past.data.full_name || past.data.email;
    return { id: clientId, name, firstName: past.data.first_name || name, removedAt: past.data.removed_at };
  }
  return null;
}
