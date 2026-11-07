// Server calls for workout logging, plus the phone-side caches that let a workout start with poor signal.
// Writes go only through save_workout_log (clients have no write privilege on the log tables). Reads are
// limited by RLS to the signed-in client's own logs while they are still a client.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOG_STATUSES,
  LOG_TREE_SELECT,
  WorkoutDoc,
  logRowToDoc,
  progressionHistoryFromRows,
  type Database,
  type IsoDate,
  type LogStatus,
  type LogTreeRow,
  type ProgressionHistory,
  type SetType,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { SaveLogResult } from './log-sync';
import { supabase } from './supabase';

type SaveArgs = Database['public']['Functions']['save_workout_log']['Args'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keeps the server's message (so log-sync can tell a dropped connection, e.g. "TypeError: Network request
 * failed", from a refusal), its SQLSTATE code and its hint (save_workout_log's 'not_a_client', see
 * log-sync isNotAClient), and logs it for developers. Screens show their own plain words, never this.
 */
function failed(what: string, error: { message: string; code?: string; hint?: string }): Error {
  console.warn(`[logs] ${what}: ${error.message}`);
  return Object.assign(new Error(`${what}: ${error.message}`), { code: error.code, hint: error.hint });
}

async function myId(): Promise<string> {
  // Read from the phone's saved session, so it works without signal.
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('You are signed out. Sign in again.');
  return id;
}

function parseSaveResult(data: unknown): SaveLogResult {
  const r = (data ?? {}) as { applied?: unknown; revision?: unknown; status?: unknown; loggedByOther?: unknown };
  if (
    typeof r.applied !== 'boolean' ||
    typeof r.revision !== 'number' ||
    !LOG_STATUSES.includes(r.status as LogStatus)
  ) {
    throw new Error('save_workout_log: unexpected response');
  }
  const result: SaveLogResult = { applied: r.applied, revision: r.revision, status: r.status as LogStatus };
  // The coach logs this workout now (single active logger): adopt, never push.
  if (r.loggedByOther === true) result.loggedByOther = true;
  return result;
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

/**
 * Auto progression: the client's last two finished sessions of these exercises for one planned workout
 * (progression_history), for the shared nextSuggestion. Empty when the workout's program has Auto progression off,
 * the workout isn't from a program, or the id isn't a uuid.
 */
export async function fetchProgression(workoutId: string, exerciseIds: string[]): Promise<ProgressionHistory> {
  const ids = [...new Set(exerciseIds)].filter((id) => UUID.test(id));
  if (!UUID.test(workoutId) || ids.length === 0) return {};
  const { data, error } = await supabase.rpc('progression_history', { p_workout_id: workoutId, p_exercise_ids: ids });
  if (error) throw failed('progression', error);
  return progressionHistoryFromRows(data);
}

/**
 * The client's log in progress on the server, if any. Used before starting a new one when the phone has none
 * (another phone, or a reinstall), so Start resumes it instead of colliding with the one-in-progress rule.
 */
export async function fetchInProgressLog(): Promise<WorkoutLogDoc | null> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select(LOG_TREE_SELECT)
    .eq('client_id', await myId())
    .eq('status', 'in_progress')
    .maybeSingle();
  if (error) throw failed('log in progress', error);
  if (!data) return null;
  return logRowToDoc(data as unknown as LogTreeRow);
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

export type LogForDay = {
  id: string;
  workoutId: string;
  scheduledOn: IsoDate;
  status: LogStatus;
  name: string;
  startedAt: string;
  finishedAt: string | null;
  lastActivityAt: string;
};

/**
 * The client's logs of planned workouts scheduled from `from` to `to` inclusive, for "Done ✓" and "Resume".
 * Matched by the planned workout's scheduled_on, never by finished_at's UTC date. Discarded logs are left out.
 */
export async function fetchLogsForDays(from: IsoDate, to: IsoDate): Promise<LogForDay[]> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, workout_id, status, name, started_at, finished_at, last_activity_at, workouts!inner(scheduled_on)')
    .eq('client_id', await myId())
    .neq('status', 'discarded')
    .gte('workouts.scheduled_on', from)
    .lte('workouts.scheduled_on', to);
  if (error) throw failed('logs for days', error);
  const out: LogForDay[] = [];
  for (const row of data) {
    const scheduledOn = row.workouts.scheduled_on;
    if (row.workout_id === null || scheduledOn === null) continue;
    out.push({
      id: row.id,
      workoutId: row.workout_id,
      scheduledOn,
      status: row.status,
      name: row.name,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      lastActivityAt: row.last_activity_at,
    });
  }
  return out;
}

const todayLogsKey = (userId: string) => `caltracker.todayLogs.${userId}`;

/** Keeps today's logs (from fetchLogsForDays) on the phone, so Today offline still shows Done ✓ and Resume. */
export async function cacheTodayLogs(today: IsoDate, logs: LogForDay[]): Promise<void> {
  await AsyncStorage.setItem(todayLogsKey(await myId()), JSON.stringify({ date: today, logs }));
}

/** Today's cached logs, or none when they are from another day or unreadable. */
export async function readCachedTodayLogs(today: IsoDate): Promise<LogForDay[]> {
  try {
    const raw = await AsyncStorage.getItem(todayLogsKey(await myId()));
    if (raw === null) return [];
    const value = JSON.parse(raw) as { date?: unknown; logs?: unknown };
    if (value.date !== today || !Array.isArray(value.logs)) return [];
    return value.logs.filter(
      (l): l is LogForDay =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as LogForDay).id === 'string' &&
        typeof (l as LogForDay).workoutId === 'string' &&
        LOG_STATUSES.includes((l as LogForDay).status) &&
        typeof (l as LogForDay).startedAt === 'string' &&
        typeof (l as LogForDay).lastActivityAt === 'string',
    );
  } catch {
    return []; // a cache miss is never worth failing the screen over
  }
}

/** What the workout detail screen needs to start a workout (the shape fetchWorkoutDetail returns). */
export type CachedDetail = { doc: WorkoutDoc; scheduledOn: IsoDate; videoUrls: Record<string, string> };

const detailKey = (userId: string) => `caltracker.todayDetail.${userId}`;

/** Keeps today's workouts on the phone, replacing any earlier day's, so Start works with poor signal. */
export async function cacheTodayDetail(today: IsoDate, details: CachedDetail[]): Promise<void> {
  const value = { date: today, details: Object.fromEntries(details.map((d) => [d.doc.id, d])) };
  await AsyncStorage.setItem(detailKey(await myId()), JSON.stringify(value));
}

async function readCache(today: IsoDate): Promise<Record<string, CachedDetail>> {
  const raw = await AsyncStorage.getItem(detailKey(await myId()));
  if (raw === null) return {};
  const value = JSON.parse(raw) as { date?: unknown; details?: Record<string, CachedDetail> };
  return value.date === today && typeof value.details === 'object' && value.details !== null ? value.details : {};
}

function validDetail(hit: CachedDetail | undefined): CachedDetail | null {
  if (!hit || typeof hit.scheduledOn !== 'string') return null;
  const doc = WorkoutDoc.safeParse(hit.doc);
  if (!doc.success) return null;
  const videoUrls = typeof hit.videoUrls === 'object' && hit.videoUrls !== null ? hit.videoUrls : {};
  return { doc: doc.data, scheduledOn: hit.scheduledOn, videoUrls };
}

/** Every workout cached for today, by name, for showing Today without signal. Empty on any failure. */
export async function readCachedToday(today: IsoDate): Promise<CachedDetail[]> {
  try {
    return Object.values(await readCache(today))
      .map(validDetail)
      .filter((d): d is CachedDetail => d !== null)
      .sort((a, b) => a.doc.name.localeCompare(b.doc.name));
  } catch {
    return [];
  }
}

/** Today's cached copy of a workout, or null when it is not cached, from another day, or unreadable. */
export async function readCachedDetail(today: IsoDate, workoutId: string): Promise<CachedDetail | null> {
  try {
    return validDetail((await readCache(today))[workoutId]);
  } catch {
    return null; // a cache miss is never worth failing the screen over
  }
}
