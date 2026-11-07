'use server';

import { revalidatePath } from 'next/cache';
import { validateGoal, validateLimitations, validateNote } from '@caltracker/shared';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

// The client Overview's coach records: notes, limitations (injuries) and the goal. Every action starts with
// requireCoach() and takes the workspace from it, never from the browser. RLS does the real checking: only the coach
// of the workspace reads or writes, and only for a current client (a removed client's records are read-only).

export type RecordOutcome = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC = "Couldn't save. Please try again.";
const refresh = () => revalidatePath('/clients/[clientId]', 'layout');
/** 42501: RLS refused, which here means the person is no longer a current client. */
const refusal = (code: string | undefined) => (code === '42501' ? "This client was removed, so their records can't change." : GENERIC);

export async function addNote(clientId: string, body: string): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId) || typeof body !== 'string') return { ok: false, error: GENERIC };
  const checked = validateNote(body);
  if (!checked.ok) return checked;
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('client_notes').insert({ workspace_id: workspaceId, client_id: clientId, body: checked.value });
  if (error) return { ok: false, error: refusal(error.code) };
  refresh();
  return { ok: true };
}

export async function updateNote(noteId: string, body: string): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(noteId) || typeof body !== 'string') return { ok: false, error: GENERIC };
  const checked = validateNote(body);
  if (!checked.ok) return checked;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('client_notes').update({ body: checked.value }).eq('id', noteId).eq('workspace_id', workspaceId).select('id');
  if (error) return { ok: false, error: refusal(error.code) };
  if (data.length === 0) return { ok: false, error: 'That note is gone. Reload the page to see the latest.' };
  refresh();
  return { ok: true };
}

export async function deleteNote(noteId: string): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(noteId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('client_notes').delete().eq('id', noteId).eq('workspace_id', workspaceId);
  if (error) return { ok: false, error: "Couldn't delete the note. Please try again." };
  refresh();
  return { ok: true };
}

/** One record per client: update it, or create it the first time (a race with another tab ends in an update). */
export async function saveLimitations(clientId: string, body: string): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId) || typeof body !== 'string') return { ok: false, error: GENERIC };
  const checked = validateLimitations(body);
  if (!checked.ok) return checked;
  const supabase = await createServerSupabase();
  const update = () =>
    supabase.from('client_limitations').update({ body: checked.value }).eq('workspace_id', workspaceId).eq('client_id', clientId).select('client_id');
  let result = await update();
  if (!result.error && result.data.length === 0) {
    const inserted = await supabase.from('client_limitations').insert({ workspace_id: workspaceId, client_id: clientId, body: checked.value });
    if (inserted.error?.code === '23505') result = await update();
    else if (inserted.error) return { ok: false, error: refusal(inserted.error.code) };
  }
  if (result.error) return { ok: false, error: refusal(result.error.code) };
  refresh();
  return { ok: true };
}

export async function saveGoal(clientId: string, goal: string, targetDate: string | null): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId) || typeof goal !== 'string') return { ok: false, error: GENERIC };
  if (targetDate !== null && (typeof targetDate !== 'string' || !DATE.test(targetDate) || targetDate < '2000-01-01')) {
    return { ok: false, error: 'Pick a valid date, or leave it empty.' };
  }
  const checked = validateGoal(goal);
  if (!checked.ok) return checked;
  const supabase = await createServerSupabase();
  const row = { goal: checked.value, target_date: targetDate };
  const update = () => supabase.from('client_goals').update(row).eq('workspace_id', workspaceId).eq('client_id', clientId).select('client_id');
  let result = await update();
  if (!result.error && result.data.length === 0) {
    const inserted = await supabase.from('client_goals').insert({ workspace_id: workspaceId, client_id: clientId, ...row });
    if (inserted.error?.code === '23505') result = await update();
    else if (inserted.error) return { ok: false, error: refusal(inserted.error.code) };
  }
  if (result.error) return { ok: false, error: refusal(result.error.code) };
  refresh();
  return { ok: true };
}

export async function clearGoal(clientId: string): Promise<RecordOutcome> {
  const { workspaceId } = await requireCoach();
  if (!UUID.test(clientId)) return { ok: false, error: GENERIC };
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('client_goals').delete().eq('workspace_id', workspaceId).eq('client_id', clientId);
  if (error) return { ok: false, error: "Couldn't remove the goal. Please try again." };
  refresh();
  return { ok: true };
}
