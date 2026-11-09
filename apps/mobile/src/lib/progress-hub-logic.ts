// What the Progress tab keeps about training: each lift's series and recent sessions, the finished workouts, the
// planned ones, the running program, personal bests and which workouts set a PR. Built from the server's rows and
// saved on the phone, so Progress opens with no signal. Pure (no React, no network), so it is unit tested; every rule
// (estimated 1RM, counted sets, PRs, weeks) comes from @caltracker/shared.
import {
  awardPrEvents,
  exerciseSessions,
  isPlannedLog,
  localDay,
  strengthExercises,
  strengthSeries,
  type HomeWorkout,
  type IsoDate,
  type MacroTargets,
  type NamedRecord,
  type PrEvent,
  type ProgramAssignmentLite,
  type StrengthPoint,
  type StrengthSession,
  type WorkoutLogDoc,
  type FoodMealLite,
} from '@caltracker/shared';
import { foodCachePrefix, progressCachePrefix } from './device-cache-keys';

/** Recent sessions kept per exercise (the Strength screen lists a few). */
export const SESSIONS_KEPT = 8;

export type HubExercise = {
  exerciseId: string;
  name: string;
  /** Its first primary muscle ("quadriceps"), or null when unknown. */
  muscle: string | null;
  points: StrengthPoint[];
  sessions: StrengthSession[];
};

export type HubData = {
  version: 1;
  exercises: HubExercise[];
  /** Each finished workout's day (phone's time zone), oldest first, and whether it followed a plan. */
  finished: { day: IsoDate; planned: boolean }[];
  /** Planned workouts around the last 8 weeks and this month, with their logs. */
  workouts: HomeWorkout[];
  assignments: ProgramAssignmentLite[];
  /** Stored personal bests (heaviest and estimated max) with exercise names. */
  records: NamedRecord[];
  /** The PRs each stored award lists. */
  prEvents: PrEvent[];
};

export const hubCacheKey = (userId: string, workspaceId: string) => `${progressCachePrefix(userId)}${workspaceId}`;
export const lastExerciseKey = (userId: string) => `${progressCachePrefix(userId)}lastExercise`;
/** Under the food prefix, so Sign out forgets it with the food log. */
export const foodRangeCacheKey = (userId: string, workspaceId: string) => `${foodCachePrefix(userId)}progress.${workspaceId}`;

export function buildHub(input: {
  logs: readonly WorkoutLogDoc[];
  muscles: Record<string, string | null>;
  workouts: HomeWorkout[];
  assignments: ProgramAssignmentLite[];
  records: NamedRecord[];
  /** Each award's stored result (jsonb), by its log. */
  awardPrs: { logId: string; prs: unknown }[];
  userId: string;
  timeZone: string;
}): HubData {
  const { logs, timeZone } = input;
  const exercises = strengthExercises(logs).map((e) => ({
    ...e,
    muscle: input.muscles[e.exerciseId] ?? null,
    points: strengthSeries(logs, e.exerciseId, timeZone),
    sessions: exerciseSessions(logs, e.exerciseId, timeZone, SESSIONS_KEPT),
  }));
  const finished = logs
    .filter((l) => l.status === 'completed' && l.finishedAt)
    .map((l) => ({ at: l.finishedAt!, day: localDay(l.finishedAt!, timeZone), planned: l.workoutId !== null || isPlannedLog(l) }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ day, planned }) => ({ day, planned }));
  return {
    version: 1,
    exercises,
    finished,
    workouts: input.workouts,
    assignments: input.assignments,
    records: input.records,
    prEvents: input.awardPrs.flatMap((a) => awardPrEvents(input.userId, { prs: a.prs })),
  };
}

/** Days the client finished workouts they added themselves (not from a plan). */
export const addedDays = (h: HubData): IsoDate[] => h.finished.filter((f) => !f.planned).map((f) => f.day);

/** Every finished workout's day. */
export const trainedDays = (h: HubData): IsoDate[] => h.finished.map((f) => f.day);

/** "logId|exerciseId" for each PR, to tag recent sessions. */
export const prKeys = (h: HubData): Set<string> => new Set(h.prEvents.map((e) => `${e.logId}|${e.exerciseId}`));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The saved hub, or null when missing, unreadable or written by another version. */
export function parseHubCache(raw: string | null): HubData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || v.version !== 1) return null;
    const arrays = ['exercises', 'finished', 'workouts', 'assignments', 'records', 'prEvents'] as const;
    if (!arrays.every((k) => Array.isArray(v[k]))) return null;
    const exOk = (v.exercises as unknown[]).every(
      (e) => isObj(e) && typeof e.exerciseId === 'string' && typeof e.name === 'string' && Array.isArray(e.points) && Array.isArray(e.sessions),
    );
    const wOk = (v.workouts as unknown[]).every((w) => isObj(w) && typeof w.id === 'string' && typeof w.scheduledOn === 'string' && Array.isArray(w.logs));
    return exOk && wOk ? (v as unknown as HubData) : null;
  } catch {
    return null;
  }
}

export type FoodRange = { meals: FoodMealLite[]; targets: MacroTargets | null };

export function parseFoodRangeCache(raw: string | null): FoodRange | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isObj(v) || !Array.isArray(v.meals) || !(v.targets === null || isObj(v.targets))) return null;
    const ok = (v.meals as unknown[]).every((m) => isObj(m) && typeof m.eatenOn === 'string' && isObj(m.macros));
    return ok ? (v as unknown as FoodRange) : null;
  } catch {
    return null;
  }
}
