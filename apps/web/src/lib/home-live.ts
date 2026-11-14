import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTO_FINISH_IDLE_MS, completedSetCount, LOG_TREE_SELECT, logRowToDoc, openSetCount } from '@caltracker/shared';
import type { Database, LogTreeRow } from '@caltracker/shared';

/** A workout someone is logging right now, with how far through it they are. */
export type LiveLog = {
  id: string;
  clientId: string;
  name: string;
  startedAt: string;
  lastActivityAt: string;
  /** Sets done, and done plus still to do (the shared counting rule: a pick-one group counts once). */
  done: number;
  total: number;
};

/** Every workout in progress in the workspace, in one query (Home's "Training now"). */
export async function loadLiveLogs(supabase: SupabaseClient<Database>, workspaceId: string): Promise<LiveLog[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(`client_id, ${LOG_TREE_SELECT}`)
    .eq('workspace_id', workspaceId)
    .eq('status', 'in_progress')
    .limit(200);
  if (error) throw new Error(`Could not load workouts in progress: ${error.message}`);
  // The select string is built by concatenation, so supabase-js cannot infer its shape; LogTreeRow describes it.
  const rows = (data ?? []) as unknown as (LogTreeRow & { client_id: string })[];
  return rows.map((row) => {
    const doc = logRowToDoc(row);
    const done = completedSetCount(doc);
    return { id: doc.id, clientId: row.client_id, name: doc.name, startedAt: doc.startedAt, lastActivityAt: doc.lastActivityAt, done, total: done + openSetCount(doc) };
  });
}

/**
 * The "Training now" cards: current clients only, one per client (their latest start), leaving out a workout left
 * open with nothing logged for as long as it takes to finish by itself. Earliest start first.
 */
export function trainingNow(logs: readonly LiveLog[], currentClientIds: ReadonlySet<string>, nowMs: number): LiveLog[] {
  const latest = new Map<string, LiveLog>();
  for (const l of logs) {
    if (!currentClientIds.has(l.clientId)) continue;
    if (nowMs - Date.parse(l.lastActivityAt) >= AUTO_FINISH_IDLE_MS) continue;
    const seen = latest.get(l.clientId);
    if (!seen || Date.parse(l.startedAt) > Date.parse(seen.startedAt)) latest.set(l.clientId, l);
  }
  return [...latest.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * Each client's workout in progress (the latest start), from the same logs as "Training now" but without dropping
 * long-idle ones: any log in progress blocks starting another workout for that client.
 */
export function liveLogByClient(logs: readonly LiveLog[]): Map<string, string> {
  const latest = new Map<string, LiveLog>();
  for (const l of logs) {
    const seen = latest.get(l.clientId);
    if (!seen || Date.parse(l.startedAt) > Date.parse(seen.startedAt)) latest.set(l.clientId, l);
  }
  return new Map([...latest].map(([clientId, l]) => [clientId, l.id]));
}

/** Whole minutes since the start, never negative. */
export const minutesSince = (startedAt: string, nowMs: number): number => Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 60_000));
