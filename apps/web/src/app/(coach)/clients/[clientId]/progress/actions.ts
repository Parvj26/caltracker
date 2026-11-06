'use server';

import { revalidatePath } from 'next/cache';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// Every action starts with requireCoach(). The database does the real checking: save_body_measurement validates the
// ranges and who may write what, and RLS limits deletes and custom measure changes to this workspace's coach. The
// workspace id is never taken from the browser. Printout files are removed through the Storage API, never by SQL on
// storage.objects (that would leave the real file behind).

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; warning?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BUCKET = 'scan-attachments';
const UPLOAD_LEFT_BEHIND = "The scan wasn't saved, and the uploaded printout file could not be removed.";
const GENERIC = "Couldn't save. Please try again.";
const refresh = () => revalidatePath('/clients/[clientId]', 'page');

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
    return { ok: false, error: 'The scan is not valid.' };
  }
  if (typeof values !== 'object' || values === null || Object.values(values).some((v) => typeof v !== 'number')) {
    return { ok: false, error: 'The scan is not valid.' };
  }
  if (attachmentPath != null && (typeof attachmentPath !== 'string' || !attachmentPath.startsWith(`${workspaceId}/${clientId}/`))) {
    return { ok: false, error: 'The printout does not belong to this client.' };
  }

  const supabase = await createServerSupabase();
  const before = await supabase.from('body_measurements').select('attachment_path').eq('id', id).maybeSingle();
  // Without the current printout path, a replaced or cleared file could be left behind unnoticed: stop here.
  if (before.error) return { ok: false, error: GENERIC };
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
    // 42501 and 23514 messages are written for people (e.g. "Add a new scan instead.").
    const message = error.code === '42501' || error.code === '23514' ? error.message : GENERIC;
    return warning ? { ok: false, error: message, warning } : { ok: false, error: message };
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
  if (!isUuid(id)) return { ok: false, error: 'The scan is not valid.' };
  const supabase = await createServerSupabase();
  const row = await supabase.from('body_measurements').select('attachment_path').eq('id', id).maybeSingle();
  if (row.error) return { ok: false, error: GENERIC };
  if (!row.data) return { ok: false, error: 'That scan is already gone.' };

  const { data, error } = await supabase.from('body_measurements').delete().eq('id', id).select('id');
  if (error) return { ok: false, error: "Couldn't delete the scan. Please try again." };
  if (data.length === 0) return { ok: false, error: "You can't delete that scan." };

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
  if (name.length < 1 || name.length > 40) return { ok: false, error: 'Give the measure a name of up to 40 characters.' };
  if (unitLabel.length > 10) return { ok: false, error: 'The unit label can be up to 10 characters.' };
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return { ok: false, error: 'The smallest value must be below the largest.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('custom_metrics').insert({ workspace_id: workspaceId, name, unit_label: unitLabel, min, max });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'You already have a measure with that name.' };
    return { ok: false, error: GENERIC };
  }
  refresh();
  return { ok: true };
}

/** Archiving hides a measure from the scan form but keeps its history. */
export async function archiveCustomMeasure(id: string): Promise<Outcome> {
  const { workspaceId } = await requireCoach();
  if (!isUuid(id)) return { ok: false, error: 'The measure is not valid.' };
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('custom_metrics')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .select('id');
  if (error || data.length === 0) return { ok: false, error: "Couldn't archive that measure." };
  refresh();
  return { ok: true };
}
