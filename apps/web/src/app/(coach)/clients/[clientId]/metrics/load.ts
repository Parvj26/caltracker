import type { SupabaseClient } from '@supabase/supabase-js';
import { toMetricEntries, type Database, type MetricEntry } from '@caltracker/shared';

// The Metrics tab's data: every value of one client from the metric_entries view, which puts the new Metrics entries
// together with InBody scan values and the client's weigh-ins from the older body tables. The view runs with the
// coach's own rights, so RLS limits it to this workspace. Cards, changes and trend lines are worked out from these
// rows with metricsSummary / metricSummary from @caltracker/shared.

const LIMIT = 5000;

export async function loadMetricEntries(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
): Promise<MetricEntry[]> {
  const { data, error } = await supabase
    .from('metric_entries')
    .select('origin, id, metric_key, value, measured_on, measured_at, created_at, source, entered_by_role, external_id')
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .order('measured_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`Could not load metrics: ${error.message}`);
  return toMetricEntries(data);
}
