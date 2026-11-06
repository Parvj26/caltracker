import { addDays, localToday } from '@caltracker/shared';
import type { createServerSupabase } from '@/lib/supabase/server';

export type LiveSyncState = { on: boolean; clients: number; syncedAt: string | null; skipped: number };

/**
 * A program's Live Sync switch, last sync and the number of clients on it: assignments not yet over and not cancelled
 * (a day of slack for the coach's time zone), of people who are still clients. Null when the program isn't in this
 * workspace.
 */
export async function loadLiveSync(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  workspaceId: string,
  programId: string,
): Promise<LiveSyncState | null> {
  const yesterday = addDays(localToday('UTC'), -1);
  const [program, assignments, members] = await Promise.all([
    supabase
      .from('programs')
      .select('live_sync, live_synced_at, live_sync_skipped')
      .eq('id', programId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('program_assignments')
      .select('client_id, cancelled_on')
      .eq('program_id', programId)
      .eq('workspace_id', workspaceId)
      .gte('end_date', yesterday),
    supabase.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('role', 'client'),
  ]);
  if (program.error) throw new Error(`Could not load Live Sync: ${program.error.message}`);
  if (assignments.error) throw new Error(`Could not load assignments: ${assignments.error.message}`);
  if (members.error) throw new Error(`Could not load clients: ${members.error.message}`);
  if (!program.data) return null;
  const current = new Set(members.data.map((m) => m.user_id));
  const clients = new Set(
    assignments.data
      .filter((a) => current.has(a.client_id) && (a.cancelled_on === null || a.cancelled_on > yesterday))
      .map((a) => a.client_id),
  ).size;
  return {
    on: program.data.live_sync,
    clients,
    syncedAt: program.data.live_synced_at,
    skipped: program.data.live_sync_skipped,
  };
}
