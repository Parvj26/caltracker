// The client's own body scans and weight. Reads go through RLS (a client sees only their own entries while they
// are still a client). Writes go through save_body_measurement, which checks the range and that a client may
// save only weight, only for themself, and only edit entries they made. Deleting an entry is a plain delete the
// database allows only on the client's own entries.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import type { IsoDate } from '@caltracker/shared';
import { parseCachedProgress, serializeProgress, type ProgressRows } from './progress';
import { supabase } from './supabase';

export const PROGRESS_LOAD_FAILED = 'Something went wrong. Pull down to try again.';
export const WEIGHT_SAVE_FAILED = 'Could not save your weight. Check your connection and try again.';
export const WEIGHT_DELETE_FAILED = 'Could not delete that entry. Check your connection and try again.';
export const PRINTOUT_FAILED = 'Could not open the printout. Try again.';

const SIGNED_FOR_S = 600;
const LIMIT = 1000;
const cacheKey = (userId: string) => `caltracker.progress.${userId}`;

function warn(what: string, error: { message: string }): void {
  console.warn(`[body] ${what}: ${error.message}`);
}

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

/** The copy saved on the phone by the last successful read, or null. */
export async function readCachedProgress(userId: string): Promise<ProgressRows | null> {
  try {
    return parseCachedProgress(await AsyncStorage.getItem(cacheKey(userId)));
  } catch {
    return null;
  }
}

/** Every scan of the signed-in client (newest first, whoever entered it) and the workspace's custom measures. Saves a copy on the phone. */
export async function fetchMyProgress(): Promise<ProgressRows> {
  const userId = await myId();
  const [scans, customs] = await Promise.all([
    supabase
      .from('body_measurements')
      .select('id, measured_on, created_at, source, attachment_path, body_measurement_values(metric_key, value)')
      .eq('client_id', userId)
      .order('measured_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase.from('custom_metrics').select('id, name, unit_label, min, max').order('created_at'),
  ]);
  if (scans.error) {
    warn('scans', scans.error);
    throw new Error(PROGRESS_LOAD_FAILED);
  }
  if (customs.error) {
    warn('custom measures', customs.error);
    throw new Error(PROGRESS_LOAD_FAILED);
  }
  const rows: ProgressRows = {
    scans: scans.data.map((s) => ({
      id: s.id,
      measuredOn: s.measured_on,
      createdAt: s.created_at,
      source: s.source === 'client' ? 'client' : 'coach',
      attachmentPath: s.attachment_path,
      values: Object.fromEntries(s.body_measurement_values.map((v) => [v.metric_key, Number(v.value)])),
    })),
    customs: customs.data.map((c) => ({ ...c, min: Number(c.min), max: Number(c.max) })),
  };
  void AsyncStorage.setItem(cacheKey(userId), serializeProgress(rows)).catch(() => undefined);
  return rows;
}

/**
 * Logs (or, with `id`, changes) one of the client's own weight entries. The id is made on the phone, so a retry
 * after a dropped connection updates the same entry instead of adding a second.
 */
export async function saveMyWeight(input: {
  workspaceId: string;
  measuredOn: IsoDate;
  weightKg: number;
  id?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('save_body_measurement', {
    p: {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspaceId,
      client_id: await myId(),
      measured_on: input.measuredOn,
      values: { weight_kg: input.weightKg },
    },
  });
  if (error) {
    warn('save weight', error);
    throw new Error(WEIGHT_SAVE_FAILED);
  }
}

/** Deletes one of the client's own weight entries (the database refuses anything else). */
export async function deleteMyWeight(id: string): Promise<void> {
  const { data, error } = await supabase.from('body_measurements').delete().eq('id', id).select('id');
  if (error || data.length === 0) {
    if (error) warn('delete weight', error);
    throw new Error(WEIGHT_DELETE_FAILED);
  }
}

/** A short-lived link to a printout in the private bucket. */
export async function printoutUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('scan-attachments').createSignedUrl(path, SIGNED_FOR_S);
  if (error || !data) {
    if (error) warn('printout link', error);
    throw new Error(PRINTOUT_FAILED);
  }
  return data.signedUrl;
}
