import type { SupabaseClient } from '@supabase/supabase-js';
import { isBodyRegionId, type ClientFlag, type Database } from '@caltracker/shared';

// Client flags (pains, injuries, limitations): coach-only rows in public.client_flags. Read under the coach's own
// session, so RLS limits them to the coach's workspace; the workspace id comes from requireCoach(). No server-only
// imports here (client-overview.ts is reached from client components); getOpenClientFlags is in client-flags.ts.

export const FLAG_COLUMNS = 'id, client_id, region, side, type, since, note, status, resolved_on, created_at';

type FlagRow = Pick<
  Database['public']['Tables']['client_flags']['Row'],
  'id' | 'client_id' | 'region' | 'side' | 'type' | 'since' | 'note' | 'status' | 'resolved_on' | 'created_at'
>;

/** A row as the apps use it. An unknown region (from a newer catalogue) reads as General. */
export function rowToFlag(r: FlagRow): ClientFlag {
  return {
    id: r.id,
    region: r.region !== null && isBodyRegionId(r.region) ? r.region : null,
    side: r.side as ClientFlag['side'],
    type: r.type as ClientFlag['type'],
    since: r.since,
    note: r.note,
    status: r.status as ClientFlag['status'],
    resolvedOn: r.resolved_on,
    createdAt: r.created_at,
  };
}

/** Every flag of one or more clients (open and resolved), by client. */
export async function loadClientFlags(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientIds: readonly string[],
  { openOnly = false }: { openOnly?: boolean } = {},
): Promise<Map<string, ClientFlag[]>> {
  const out = new Map<string, ClientFlag[]>(clientIds.map((id) => [id, []]));
  if (clientIds.length === 0) return out;
  let query = supabase.from('client_flags').select(FLAG_COLUMNS).eq('workspace_id', workspaceId).in('client_id', [...clientIds]);
  if (openOnly) query = query.eq('status', 'open');
  const { data, error } = await query.order('since', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load flags: ${error.message}`);
  for (const r of data) out.get(r.client_id)?.push(rowToFlag(r));
  return out;
}

