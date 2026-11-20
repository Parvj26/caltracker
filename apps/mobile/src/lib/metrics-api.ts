// The client's own Metrics. Reads come from the metric_entries view (new Metrics entries plus InBody scan values and
// weigh-ins from the older body tables), through RLS: a client sees only their own entries while still a client.
// Writes go to body_metrics, which RLS limits to the client's own entries marked as theirs; scans and old weigh-ins
// stay where they are (body-api.ts). Apple Health samples go through sync_apple_health_metrics, so a re-sync updates
// instead of adding duplicates.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { readAllPages, toMetricEntries, type IsoDate, type MetricEntry, type MetricKey } from '@caltracker/shared';
import { progressCachePrefix } from './device-cache-keys';
import { DELETE_CHUNK, appleHealthBatches, chunk, parseCachedMetrics, serializeMetrics, type AppleHealthSample } from './metrics-logic';
import { supabase } from './supabase';

export const METRICS_LOAD_FAILED = 'Something went wrong. Pull down to try again.';
export const METRIC_SAVE_FAILED = 'Could not save that. Check your connection and try again.';
export const METRIC_DELETE_FAILED = 'Could not delete that entry. Check your connection and try again.';
export const APPLE_HEALTH_SYNC_FAILED = 'Could not bring in your Apple Health data. Try again later.';

// Under the Progress prefix, so Sign out forgets it (keysToForget).
const cacheKey = (userId: string, workspaceId: string) => `${progressCachePrefix(userId)}metrics.${workspaceId}`;

function warn(what: string, error: { message: string }): void {
  console.warn(`[metrics] ${what}: ${error.message}`);
}

async function myId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

/** The copy saved on the phone by the last successful read, or null. */
export async function readCachedMetrics(userId: string, workspaceId: string): Promise<MetricEntry[] | null> {
  try {
    return parseCachedMetrics(await AsyncStorage.getItem(cacheKey(userId, workspaceId)));
  } catch {
    return null;
  }
}

/** Every Metrics value of the signed-in client with this coach, newest first. Saves a copy on the phone. */
export async function fetchMyMetrics(userId: string, workspaceId: string): Promise<MetricEntry[]> {
  // Page by page: the server returns at most 1000 rows per request (see readAllPages).
  const rows = await readAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('metric_entries')
      .select('origin, id, metric_key, value, measured_on, measured_at, created_at, source, entered_by_role, external_id')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .order('measured_on', { ascending: false })
      .order('created_at', { ascending: false })
      .order('origin')
      .order('id')
      .order('metric_key')
      .range(from, to);
    if (error) {
      warn('load', error);
      throw new Error(METRICS_LOAD_FAILED);
    }
    return data;
  });
  const entries = toMetricEntries(rows);
  void AsyncStorage.setItem(cacheKey(userId, workspaceId), serializeMetrics(entries)).catch(() => undefined);
  return entries;
}

/**
 * Logs (or, with `id`, changes) one of the client's own entries. `value` is in stored units (parseMetricInput). The id
 * is made on the phone, so a retry after a dropped connection changes the same entry instead of adding a second.
 */
export async function saveMyMetric(input: {
  workspaceId: string;
  metricKey: MetricKey;
  measuredOn: IsoDate;
  value: number;
  id?: string;
}): Promise<string> {
  const id = input.id ?? randomUUID();
  const updated = await supabase
    .from('body_metrics')
    .update({ value: input.value, measured_on: input.measuredOn })
    .eq('id', id)
    .select('id');
  if (updated.error) {
    warn('save', updated.error);
    throw new Error(METRIC_SAVE_FAILED);
  }
  if (updated.data.length > 0) return id;
  const { error } = await supabase.from('body_metrics').insert({
    id,
    workspace_id: input.workspaceId,
    client_id: await myId(),
    metric_key: input.metricKey,
    value: input.value,
    measured_on: input.measuredOn,
    source: 'manual',
    entered_by_role: 'client',
  });
  if (error) {
    warn('save', error);
    throw new Error(METRIC_SAVE_FAILED);
  }
  return id;
}

/** Deletes one of the client's own entries (the database refuses anything else). */
export async function deleteMyMetric(id: string): Promise<void> {
  const { data, error } = await supabase.from('body_metrics').delete().eq('id', id).select('id');
  if (error || data.length === 0) {
    if (error) warn('delete', error);
    throw new Error(METRIC_DELETE_FAILED);
  }
}

/** Sends Apple Health samples (in stored units). Returns how many entries were added or changed. */
export async function syncAppleHealthMetrics(workspaceId: string, samples: readonly AppleHealthSample[]): Promise<number> {
  let changed = 0;
  for (const batch of appleHealthBatches(samples)) {
    const { data, error } = await supabase.rpc('sync_apple_health_metrics', { p_workspace_id: workspaceId, p_samples: batch });
    if (error) {
      warn('apple health sync', error);
      throw new Error(APPLE_HEALTH_SYNC_FAILED);
    }
    changed += data;
  }
  return changed;
}

/**
 * Removes everything imported from Apple Health with this coach (for when the client turns the import off and
 * chooses to remove it, or a sample was deleted in Apple Health: pass its ids).
 */
export async function deleteMyAppleHealthMetrics(workspaceId: string, externalIds?: readonly string[]): Promise<void> {
  // Ids go in the request address, so at most 100 per request.
  const groups = externalIds ? chunk(externalIds, DELETE_CHUNK) : [null];
  for (const ids of groups) {
    let q = supabase.from('body_metrics').delete().eq('workspace_id', workspaceId).eq('source', 'apple_health');
    if (ids) q = q.in('external_id', ids);
    const { error } = await q;
    if (error) {
      warn('apple health delete', error);
      throw new Error(METRIC_DELETE_FAILED);
    }
  }
}
