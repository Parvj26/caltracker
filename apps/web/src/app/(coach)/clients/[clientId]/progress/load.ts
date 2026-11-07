import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import type { CustomMetric } from './scan-form';

export type ScanRow = {
  id: string;
  measuredOn: string;
  createdAt: string;
  source: 'coach' | 'client';
  /** Signed link to the printout (valid for an hour), or null. */
  printoutUrl: string | null;
  hasPrintout: boolean;
  values: Record<string, number>;
};
export type ProgressData = { scans: ScanRow[]; customs: CustomMetric[] };

const SIGNED_FOR_S = 3600;
const LIMIT = 1000;

/** Every scan of one client (newest first) with its values, and the workspace's custom measures. Reads go through RLS. */
export async function loadProgress(supabase: SupabaseClient<Database>, workspaceId: string, clientId: string): Promise<ProgressData> {
  const [scans, customs] = await Promise.all([
    supabase
      .from('body_measurements')
      .select('id, measured_on, created_at, source, attachment_path, body_measurement_values(metric_key, value)')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .order('measured_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase.from('custom_metrics').select('id, name, unit_label, min, max, archived_at').eq('workspace_id', workspaceId).order('created_at'),
  ]);
  if (scans.error) throw new Error(`Could not load scans: ${scans.error.message}`);
  if (customs.error) throw new Error(`Could not load custom measures: ${customs.error.message}`);

  const paths = scans.data.flatMap((s) => (s.attachment_path ? [s.attachment_path] : []));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const signed = await supabase.storage.from('scan-attachments').createSignedUrls(paths, SIGNED_FOR_S);
    if (signed.error) throw new Error(`Could not load printouts: ${signed.error.message}`);
    for (const s of signed.data) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return {
    scans: scans.data.map((s) => ({
      id: s.id,
      measuredOn: s.measured_on,
      createdAt: s.created_at,
      source: s.source === 'client' ? 'client' : 'coach',
      printoutUrl: s.attachment_path ? (urls.get(s.attachment_path) ?? null) : null,
      hasPrintout: s.attachment_path !== null,
      values: Object.fromEntries(s.body_measurement_values.map((v) => [v.metric_key, Number(v.value)])),
    })),
    customs: customs.data.map((c) => ({ ...c, min: Number(c.min), max: Number(c.max) })),
  };
}
