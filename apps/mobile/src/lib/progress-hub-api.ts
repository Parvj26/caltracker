// Server reads for the Progress tab's training and food sections, each saved on the phone so Progress opens with no
// signal. Reads go through RLS: a client sees only their own logs, workouts, programs, records, awards and meals.
// Nothing here writes.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LOG_TREE_SELECT,
  addDays,
  logRowToDoc,
  startOfWeek,
  type HomeWorkout,
  type IsoDate,
  type LogTreeRow,
  type PrKind,
} from '@caltracker/shared';
import { fetchTargets } from './food-api';
import {
  buildHub,
  foodRangeCacheKey,
  hubCacheKey,
  lastExerciseKey,
  parseFoodRangeCache,
  parseHubCache,
  type FoodRange,
  type HubData,
} from './progress-hub-logic';
import { supabase } from './supabase';

/** The most recent finished workouts read for the charts (as the old Strength section). */
const LOG_LIMIT = 300;
const AWARD_LIMIT = 300;
/** Planned workouts from this many weeks back (the Consistency bars). */
const WEEKS_BACK = 8;

async function read<T>(key: string, parse: (raw: string | null) => T | null): Promise<T | null> {
  try {
    return parse(await AsyncStorage.getItem(key));
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  // The copy on the phone is a convenience: never fail a screen over it.
  void AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
}

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const readCachedHub = (userId: string, workspaceId: string) => read(hubCacheKey(userId, workspaceId), parseHubCache);

/** Reads the training side of Progress and saves it. Throws when the server can't be reached. */
export async function fetchHub(userId: string, workspaceId: string, today: IsoDate): Promise<HubData> {
  const thisMonday = startOfWeek(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = [addDays(thisMonday, -7 * (WEEKS_BACK - 1)), startOfWeek(monthStart)].sort()[0];
  const to = addDays(thisMonday, 6 + 35); // this week, and the rest of this month
  const [logs, workouts, assignments, records, awards] = await Promise.all([
    supabase
      .from('workout_logs')
      .select(LOG_TREE_SELECT)
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LOG_LIMIT),
    supabase
      .from('workouts')
      .select('id, name, scheduled_on, workout_logs(id, status, started_at, finished_at, last_activity_at)')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .gte('scheduled_on', from)
      .lte('scheduled_on', to)
      .order('scheduled_on'),
    supabase
      .from('program_assignments')
      .select('program_name, weeks, start_date, end_date, cancelled_on')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId),
    supabase
      .from('personal_records')
      .select('exercise_id, kind, value_kg, reps, achieved_at, exercises(name)')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .in('kind', ['heaviest', 'e1rm']),
    supabase
      .from('awards')
      .select('log_id, prs:result->prs')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(AWARD_LIMIT),
  ]);
  if (logs.error) throw new Error(`workout_logs: ${logs.error.message}`);
  if (workouts.error) throw new Error(`workouts: ${workouts.error.message}`);
  if (assignments.error) throw new Error(`program_assignments: ${assignments.error.message}`);
  if (records.error) throw new Error(`personal_records: ${records.error.message}`);
  if (awards.error) throw new Error(`awards: ${awards.error.message}`);

  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const docs = (logs.data as unknown as LogTreeRow[]).map(logRowToDoc);
  const ids = [...new Set(docs.flatMap((l) => l.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId))))];
  const muscles: Record<string, string | null> = {};
  if (ids.length > 0) {
    // Only groups the exercise list: never worth failing the screen over.
    const ex = await supabase.from('exercises').select('id, primary_muscles').in('id', ids);
    for (const e of ex.data ?? []) muscles[e.id] = e.primary_muscles[0] ?? null;
  }

  const planned: HomeWorkout[] = workouts.data.flatMap((w) =>
    w.scheduled_on
      ? [
          {
            id: w.id,
            clientId: userId,
            name: w.name,
            scheduledOn: w.scheduled_on,
            logs: w.workout_logs.map((l) => ({
              id: l.id,
              status: l.status,
              startedAt: l.started_at,
              finishedAt: l.finished_at,
              lastActivityAt: l.last_activity_at,
            })),
          },
        ]
      : [],
  );

  const hub = buildHub({
    logs: docs,
    muscles,
    workouts: planned,
    assignments: assignments.data.map((a) => ({
      programName: a.program_name,
      weeks: a.weeks,
      startDate: a.start_date,
      endDate: a.end_date,
      cancelledOn: a.cancelled_on,
    })),
    records: records.data.map((r) => ({
      exerciseId: r.exercise_id,
      name: r.exercises?.name ?? 'Exercise',
      kind: r.kind as PrKind, // the check constraint and the .in() filter above allow only heaviest and e1rm
      valueKg: Number(r.value_kg),
      reps: r.reps,
      achievedAt: r.achieved_at,
    })),
    awardPrs: awards.data.map((a) => ({ logId: a.log_id, prs: a.prs })),
    userId,
    timeZone: deviceZone(),
  });
  save(hubCacheKey(userId, workspaceId), hub);
  return hub;
}

export const readCachedFoodRange = (userId: string, workspaceId: string) => read(foodRangeCacheKey(userId, workspaceId), parseFoodRangeCache);

/** The client's meals over the last 4 weeks and this week, with the coach's targets. Throws offline. */
export async function fetchFoodRange(userId: string, workspaceId: string, today: IsoDate): Promise<FoodRange> {
  const [meals, targets] = await Promise.all([
    supabase
      .from('meals')
      .select('eaten_on, calories, protein_g, carbs_g, fat_g, photo_path')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .gte('eaten_on', addDays(today, -27))
      .lte('eaten_on', addDays(startOfWeek(today), 6)),
    fetchTargets(userId, workspaceId),
  ]);
  if (meals.error) throw new Error(`meals: ${meals.error.message}`);
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  const range: FoodRange = {
    meals: meals.data.map((m) => ({
      eatenOn: m.eaten_on,
      hasPhoto: m.photo_path !== null,
      macros: { calories: num(m.calories), protein: num(m.protein_g), carbs: num(m.carbs_g), fat: num(m.fat_g) },
    })),
    targets,
  };
  save(foodRangeCacheKey(userId, workspaceId), range);
  return range;
}

/** The exercise last picked on the Strength screen, or null. */
export async function readLastExercise(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(lastExerciseKey(userId));
  } catch {
    return null;
  }
}

export function rememberLastExercise(userId: string, exerciseId: string): void {
  void AsyncStorage.setItem(lastExerciseKey(userId), exerciseId).catch(() => undefined);
}
