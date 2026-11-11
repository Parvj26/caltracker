'use server';

import { revalidatePath } from 'next/cache';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every action starts with requireCoach(). The database does the real checking: save_body_measurement validates the
// ranges and who may write what, and RLS limits deletes and custom measure changes to this workspace's coach. The
// workspace id is never taken from the browser. Printout files are removed through the Storage API, never by SQL on
// storage.objects (that would leave the real file behind).

export type Outcome<T extends object = object> = ({ ok: true } & T) | (ActionFailure & { warning?: string });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BUCKET = 'scan-attachments';
const UPLOAD_LEFT_BEHIND = "The scan wasn't saved, and the uploaded printout file could not be removed.";
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');

export type SaveScanInput = {
  /** Made in the browser when the form opens, so a retry edits the same scan instead of adding another. */
  id: string;
  clientId: string;
  measuredOn: string;
  /** Stored values: kg for mass measures. */
  values: Record<string, number>;
  /** undefined keeps the current printout, null removes it, a path replaces it (the file is already uploaded). */
  attachmentPath?: string | null;
};

export async function saveScan(input: SaveScanInput): Promise<Outcome<{ warning?: string }>> {
  const { workspaceId } = await requireCoach();
  const { id, clientId, measuredOn, values, attachmentPath } = input;
  if (!isUuid(id) || !isUuid(clientId) || typeof measuredOn !== 'string' || !DATE.test(measuredOn)) {
    return fail('scan_invalid', 'action:progress.saveScan');
  }
  if (typeof values !== 'object' || values === null || Object.values(values).some((v) => typeof v !== 'number')) {
    return fail('scan_invalid', 'action:progress.saveScan');
  }
  if (attachmentPath != null && (typeof attachmentPath !== 'string' || !attachmentPath.startsWith(`${workspaceId}/${clientId}/`))) {
    return fail('scan_printout_invalid', 'action:progress.saveScan');
  }

  const supabase = await createServerSupabase();
  const before = await supabase.from('body_measurements').select('attachment_path').eq('id', id).maybeSingle();
  // Without the current printout path, a replaced or cleared file could be left behind unnoticed: stop here.
  if (before.error) return fail('scan_save_failed', 'action:progress.saveScan');
  const oldPath = before.data?.attachment_path ?? null;

  const p: Record<string, unknown> = { id, workspace_id: workspaceId, client_id: clientId, measured_on: measuredOn, values };
  if (attachmentPath !== undefined) p.attachment_path = attachmentPath;
  const { error } = await supabase.rpc('save_body_measurement', { p: p as never });
  if (error) {
    // A new file was uploaded for a save that did not happen: take it back.
    let warning: string | undefined;
    if (typeof attachmentPath === 'string' && attachmentPath !== oldPath) {
      const removed = await supabase.storage.from(BUCKET).remove([attachmentPath]);
      if (removed.error) warning = UPLOAD_LEFT_BEHIND;
    }
    // Only a code goes back: some database messages name a custom measure the coach typed.
    const code =
      error.code === '42501'
        ? /new scan/i.test(error.message) ? 'scan_edit_denied' : 'scan_save_denied'
        : error.code === '23514'
          ? /printout/i.test(error.message) ? 'scan_printout_invalid' : /at least one/i.test(error.message) ? 'scan_empty' : 'scan_invalid'
          : 'scan_save_failed';
    const failed = fail(code, 'action:progress.saveScan');
    return warning ? { ...failed, warning } : failed;
  }

  let warning: string | undefined;
  if (attachmentPath !== undefined && oldPath && oldPath !== attachmentPath) {
    const removed = await supabase.storage.from(BUCKET).remove([oldPath]);
    if (removed.error) warning = 'Saved, but the old printout could not be removed.';
  }
  refresh();
  return warning ? { ok: true, warning } : { ok: true };
}

export async function deleteScan(id: string): Promise<Outcome<{ warning?: string }>> {
  await requireCoach();
  if (!isUuid(id)) return fail('scan_invalid', 'action:progress.deleteScan');
  const supabase = await createServerSupabase();
  const row = await supabase.from('body_measurements').select('attachment_path').eq('id', id).maybeSingle();
  if (row.error) return fail('scan_save_failed', 'action:progress.deleteScan');
  if (!row.data) return fail('scan_already_gone', 'action:progress.deleteScan');

  const { data, error } = await supabase.from('body_measurements').delete().eq('id', id).select('id');
  if (error) return fail('scan_delete_failed', 'action:progress.deleteScan');
  if (data.length === 0) return fail('scan_delete_denied', 'action:progress.deleteScan');

  let warning: string | undefined;
  const path = row.data.attachment_path;
  if (path) {
    const removed = await supabase.storage.from(BUCKET).remove([path]);
    if (removed.error) warning = 'The scan is deleted, but its printout file could not be removed.';
  }
  refresh();
  return warning ? { ok: true, warning } : { ok: true };
}

export type CustomMeasureInput = { name: string; unitLabel: string; min: number; max: number };

export async function addCustomMeasure(input: CustomMeasureInput): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  const name = String(input.name ?? '').trim();
  const unitLabel = String(input.unitLabel ?? '').trim();
  const { min, max } = input;
  if (name.length < 1 || name.length > 40) return fail('measure_name_invalid', 'action:progress.addCustomMeasure');
  if (unitLabel.length > 10) return fail('measure_unit_too_long', 'action:progress.addCustomMeasure');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return fail('measure_range_invalid', 'action:progress.addCustomMeasure');

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('custom_metrics').insert({ workspace_id: workspaceId, name, unit_label: unitLabel, min, max });
  if (error) {
    if (error.code === '23505') return fail('measure_name_taken', 'action:progress.addCustomMeasure');
    return fail('scan_save_failed', 'action:progress.addCustomMeasure');
  }
  refresh();
  return { ok: true };
}

/** Archiving hides a measure from the scan form but keeps its history. */
export async function archiveCustomMeasure(id: string): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return fail('measure_invalid', 'action:progress.archiveCustomMeasure');
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('custom_metrics')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .select('id');
  if (error || data.length === 0) return fail('measure_archive_failed', 'action:progress.archiveCustomMeasure');
  refresh();
  return { ok: true };
}
