import type { SupabaseClient } from '@supabase/supabase-js';
import { readAllPages, toMetricEntries, type Database, type MetricEntry } from '@caltracker/shared';

// The Metrics tab's data: every value of one client from the metric_entries view, which puts the new Metrics entries
// together with InBody scan values and the client's weigh-ins from the older body tables. The view runs with the
// coach's own rights, so RLS limits it to this workspace. Cards, changes and trend lines are worked out from these
// rows with metricsSummary / metricSummary from @caltracker/shared. Read page by page (readAllPages): the server
// returns at most 1000 rows per request, and daily Apple Health values pass that within a couple of years.

export async function loadMetricEntries(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
): Promise<MetricEntry[]> {
  const rows = await readAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('metric_entries')
      .select('origin, id, metric_key, value, measured_on, measured_at, created_at, source, entered_by_role, external_id')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      // A stable order, so pages never skip or repeat a row (a scan's values share its id: metric_key tells them apart).
      .order('measured_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('origin')
      .order('id')
      .order('metric_key')
      .range(from, to);
    if (error) throw new Error(`Could not load metrics: ${error.message}`);
    return data;
  });
  return toMetricEntries(rows);
}
