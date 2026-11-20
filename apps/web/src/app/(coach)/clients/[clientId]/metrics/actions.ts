'use server';

import { revalidatePath } from 'next/cache';
import { isMetricInRange, isMetricKey, type MetricKey } from '@caltracker/shared';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// The coach logs, changes and deletes manual Metrics entries (body_metrics). Every action starts with requireCoach();
// the workspace id never comes from the browser. RLS does the real checking: the coach may add entries only for a
// current client of this workspace, marked as the coach's, and may change or delete only manual entries a coach made.
// InBody scans keep going through the scan form (progress/actions.ts).

export type Outcome = { ok: true } | ActionFailure;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');

export type SaveMetricInput = {
  /** Made in the browser when the form opens, so a retry edits the same entry instead of adding another. */
  id: string;
  clientId: string;
  metricKey: MetricKey;
  measuredOn: string;
  /** Stored value (kg, %, mL/kg/min, cm, bpm): convert with metricFromDisplay / parseMetricInput first. */
  value: number;
};

export async function saveMetricEntry(input: SaveMetricInput): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  const { id, clientId, metricKey, measuredOn, value } = input;
  if (
    !isUuid(id) || !isUuid(clientId) || !isMetricKey(metricKey) || typeof measuredOn !== 'string' ||
    !DATE.test(measuredOn) || typeof value !== 'number' || !isMetricInRange(metricKey, value)
  ) {
    return fail('metric_invalid', 'action:metrics.saveMetricEntry');
  }

  const supabase = await createServerSupabase();
  // An edit (or a retry of a save that already went through): RLS lets the update touch only the coach's own entry.
  const updated = await supabase
    .from('body_metrics')
    .update({ value, measured_on: measuredOn })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .eq('client_id', clientId)
    .eq('metric_key', metricKey)
    .select('id');
  if (updated.error) return failFor(updated.error);
  if (updated.data.length > 0) {
    refresh();
    return { ok: true };
  }

  const { error } = await supabase.from('body_metrics').insert({
    id,
    workspace_id: workspaceId,
    client_id: clientId,
    metric_key: metricKey,
    value,
    measured_on: measuredOn,
    source: 'manual',
    entered_by_role: 'coach',
  });
  if (error) {
    // The id exists but is not the coach's to change (the client's entry, or another metric).
    if (error.code === '23505') return fail('metric_edit_denied', 'action:metrics.saveMetricEntry');
    return failFor(error);
  }
  refresh();
  return { ok: true };
}

function failFor(error: { code?: string }): ActionFailure {
  if (error.code === '42501') return fail('metric_save_denied', 'action:metrics.saveMetricEntry');
  if (error.code === '23514' || error.code === '22P02') return fail('metric_invalid', 'action:metrics.saveMetricEntry');
  return fail('metric_save_failed', 'action:metrics.saveMetricEntry');
}

export async function deleteMetricEntry(id: string): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return fail('metric_invalid', 'action:metrics.deleteMetricEntry');
  const supabase = await createServerSupabase();
  const row = await supabase.from('body_metrics').select('id').eq('id', id).eq('workspace_id', workspaceId).maybeSingle();
  if (row.error) return fail('metric_delete_failed', 'action:metrics.deleteMetricEntry');
  if (!row.data) return fail('metric_already_gone', 'action:metrics.deleteMetricEntry');
  const { data, error } = await supabase.from('body_metrics').delete().eq('id', id).eq('workspace_id', workspaceId).select('id');
  if (error) return fail('metric_delete_failed', 'action:metrics.deleteMetricEntry');
  if (data.length === 0) return fail('metric_edit_denied', 'action:metrics.deleteMetricEntry');
  refresh();
  return { ok: true };
}
