// Server calls for workout logging, plus the phone-side caches that let a workout start with poor signal.
// Writes go only through save_workout_log (clients have no write privilege on the log tables). Reads are
// limited by RLS to the signed-in client's own logs while they are still a client.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOG_STATUSES,
  LOG_TREE_SELECT,
  WorkoutDoc,
  logRowToDoc,
  type Database,
  type IsoDate,
  type LogStatus,
  type LogTreeRow,
  type SetType,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { SaveLogResult } from './log-sync';
import { supabase } from './supabase';

type SaveArgs = Database['public']['Functions']['save_workout_log']['Args'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keeps the server's message (so log-sync can tell a dropped connection, e.g. "TypeError: Network request
 * failed", from a refusal) and logs it for developers. Screens show their own plain words, never this.
 */
function failed(what: string, error: { message: string }): Error {
  console.warn(`[logs] ${what}: ${error.message}`);
  return new Error(`${what}: ${error.message}`);
}

async function myId(): Promise<string> {
  // Read from the phone's saved session, so it works without signal.
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

function parseSaveResult(data: unknown): SaveLogResult {
  const r = (data ?? {}) as { applied?: unknown; revision?: unknown; status?: unknown };
  if (
    typeof r.applied !== 'boolean' ||
    typeof r.revision !== 'number' ||
    !LOG_STATUSES.includes(r.status as LogStatus)
  ) {
    throw new Error('save_workout_log: unexpected response');
  }
  return { applied: r.applied, revision: r.revision, status: r.status as LogStatus };
}

/** Uploads the whole log. Refusals (stale or locked) come back as applied=false, not as an error. */
export async function saveLog(doc: WorkoutLogDoc): Promise<SaveLogResult> {
  const { data, error } = await supabase.rpc('save_workout_log', { p_doc: doc as unknown as SaveArgs['p_doc'] });
  if (error) throw failed('save_workout_log', error);
  return parseSaveResult(data);
}

/** The server's copy of one of the client's logs, or null when it is missing or not readable. */
export async function fetchLog(id: string): Promise<WorkoutLogDoc | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase.from('workout_logs').select(LOG_TREE_SELECT).eq('id', id).maybeSingle();
  if (error) throw failed('fetch log', error);
  if (!data) return null;
  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  return logRowToDoc(data as unknown as LogTreeRow);
}

export type LastResultSet = {
  setType: SetType;
  actualReps: number | null;
  actualWeightKg: number | null;
  actualDurationS: number | null;
  actualDistanceM: number | null;
};
/** Per exercise id: the completed sets from the most recent finished log that has any ("Last time: …"). */
export type LastResults = Record<string, { finishedAt: string; sets: LastResultSet[] }>;

const numOrNull = (v: number | string | null): number | null => (v === null ? null : Number(v));

export async function fetchLastResults(exerciseIds: string[]): Promise<LastResults> {
  const ids = [...new Set(exerciseIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('last_results', { p_exercise_ids: ids });
  if (error) throw failed('last results', error);
  const out: LastResults = {};
  // The function returns rows already ordered by exercise, then block, exercise and set position.
  // Numeric columns may arrive as strings and any actual may be null, whatever the generated types say.
  for (const row of data as Array<Record<string, unknown>>) {
    const exerciseId = row.exercise_id as string;
    const entry = (out[exerciseId] ??= { finishedAt: row.finished_at as string, sets: [] });
    entry.sets.push({
      setType: row.set_type as SetType,
      actualReps: numOrNull(row.actual_reps as number | null),
      actualWeightKg: numOrNull(row.actual_weight_kg as number | string | null),
      actualDurationS: numOrNull(row.actual_duration_s as number | null),
      actualDistanceM: numOrNull(row.actual_distance_m as number | string | null),
    });
  }
  return out;
}

export type LogComment = { id: string; authorId: string | null; body: string; createdAt: string };

/** The coach's comments on a log, oldest first. */
export async function fetchComments(logId: string): Promise<LogComment[]> {
  if (!UUID.test(logId)) return [];
  const { data, error } = await supabase
    .from('workout_log_comments')
    .select('id, author_id, body, created_at')
    .eq('log_id', logId)
    .order('created_at');
  if (error) throw failed('comments', error);
  return data.map((c) => ({ id: c.id, authorId: c.author_id, body: c.body, createdAt: c.created_at }));
}

export type LogForDay = { id: string; workoutId: string; scheduledOn: IsoDate; status: LogStatus; name: string };

/**
 * The client's logs of planned workouts scheduled from `from` to `to` inclusive, for "Done ✓" and "Resume".
 * Matched by the planned workout's scheduled_on, never by finished_at's UTC date. Discarded logs are left out.
 */
export async function fetchLogsForDays(from: IsoDate, to: IsoDate): Promise<LogForDay[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, workout_id, status, name, workouts!inner(scheduled_on)')
    .eq('client_id', await myId())
    .neq('status', 'discarded')
    .gte('workouts.scheduled_on', from)
    .lte('workouts.scheduled_on', to);
  if (error) throw failed('logs for days', error);
  const out: LogForDay[] = [];
  for (const row of data) {
    const scheduledOn = row.workouts.scheduled_on;
    if (row.workout_id === null || scheduledOn === null) continue;
    out.push({ id: row.id, workoutId: row.workout_id, scheduledOn, status: row.status, name: row.name });
  }
  return out;
}

/** What the workout detail screen needs to start a workout (the shape fetchWorkoutDetail returns). */
export type CachedDetail = { doc: WorkoutDoc; scheduledOn: IsoDate; videoUrls: Record<string, string> };

const detailKey = (userId: string) => `caltracker.todayDetail.${userId}`;

/** Keeps today's workouts on the phone, replacing any earlier day's, so Start works with poor signal. */
export async function cacheTodayDetail(today: IsoDate, details: CachedDetail[]): Promise<void> {
  const value = { date: today, details: Object.fromEntries(details.map((d) => [d.doc.id, d])) };
  await AsyncStorage.setItem(detailKey(await myId()), JSON.stringify(value));
}

/** Today's cached copy of a workout, or null when it is not cached, from another day, or unreadable. */
export async function readCachedDetail(today: IsoDate, workoutId: string): Promise<CachedDetail | null> {
  try {
    const raw = await AsyncStorage.getItem(detailKey(await myId()));
    if (raw === null) return null;
    const value = JSON.parse(raw) as { date?: unknown; details?: Record<string, CachedDetail> };
    if (value.date !== today) return null;
    const hit = value.details?.[workoutId];
    if (!hit || typeof hit.scheduledOn !== 'string') return null;
    const doc = WorkoutDoc.safeParse(hit.doc);
    if (!doc.success) return null;
    const videoUrls = typeof hit.videoUrls === 'object' && hit.videoUrls !== null ? hit.videoUrls : {};
    return { doc: doc.data, scheduledOn: hit.scheduledOn, videoUrls };
  } catch {
    return null; // a cache miss is never worth failing the screen over
  }
}
