// Pure helpers for the History screen: one row per finished workout and the month's summary card. Volume, PR,
// duration and unit wording come from @caltracker/shared; this only puts them together.
import {
  isLoggedByCoach,
  toTrackingType,
  logDurationS,
  logVolumeKg,
  formatLogDuration,
  formatLogDurationShort,
  formatLogVolume,
  liftsImprovedBetween,
  localDateOf,
  type IsoDate,
  type PrEvent,
  type BlockKind,
  type SetType,
  type TrackingType,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { formatDayLabel, weekdayShort } from './workouts';

/** One finished workout, already summed (logVolumeKg, logDurationS, isLoggedByCoach, awardHasPrs). */
export type HistoryLog = {
  id: string;
  name: string;
  finishedAt: string;
  durationS: number;
  volumeKg: number;
  loggedByCoach: boolean;
  /** Who logged it (logged_by), so "Logged by Luis" names only the client's current coach. */
  loggedBy: string | null;
  pr: boolean;
};

/**
 * The slim read History needs: times, who logged it, and per set only what volume counts (no targets, notes or
 * names). The pick-one fields are there so an unpicked option's sets are left out, as everywhere else.
 */
export const HISTORY_LOG_SELECT =
  'id, name, started_at, finished_at, last_activity_at, logged_by, ' +
  'log_blocks(id, kind, picked_exercise_id, ' +
  'log_exercises(id, tracking_type, exercises!log_exercises_exercise_id_fkey(tracking_type), ' +
  'log_sets(set_type, actual_reps, actual_weight_kg, completed_at)))';

export type HistoryLogRow = {
  id: string;
  name: string;
  started_at: string;
  finished_at: string | null;
  last_activity_at: string;
  logged_by: string | null;
  log_blocks: Array<{
    id: string;
    kind: BlockKind;
    picked_exercise_id: string | null;
    log_exercises: Array<{
      id: string;
      /** What the workout measured when the coach picked other measurements (null: the library kind). */
      tracking_type?: TrackingType | null;
      exercises: { tracking_type: TrackingType } | null;
      log_sets: Array<{
        set_type: SetType;
        actual_reps: number | null;
        /** Postgres numeric may arrive as a string. */
        actual_weight_kg: number | string | null;
        completed_at: string | null;
      }>;
    }>;
  }>;
};

/** One finished log from the slim read, summed with the shared rules; null when it has no finish time. */
export function historyLogFromRow(row: HistoryLogRow, clientId: string, prLogIds: ReadonlySet<string>): HistoryLog | null {
  if (!row.finished_at) return null;
  // Only the fields logVolumeKg and logDurationS read are real; the rest are neutral fillers.
  const doc = {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastActivityAt: row.last_activity_at,
    blocks: row.log_blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      pickedExerciseId: b.picked_exercise_id,
      exercises: b.log_exercises.map((e) => ({
        id: e.id,
        trackingType: toTrackingType(e.tracking_type ?? e.exercises?.tracking_type ?? 'weight_reps'),
        sets: e.log_sets.map((s) => ({
          setType: s.set_type,
          actualReps: s.actual_reps,
          actualWeightKg: s.actual_weight_kg === null ? null : Number(s.actual_weight_kg),
          completedAt: s.completed_at,
        })),
      })),
    })),
  } as unknown as WorkoutLogDoc;
  return {
    id: row.id,
    name: row.name,
    finishedAt: row.finished_at,
    durationS: logDurationS(doc),
    volumeKg: logVolumeKg(doc),
    loggedByCoach: isLoggedByCoach({ loggedBy: row.logged_by, clientId }),
    loggedBy: row.logged_by,
    pr: prLogIds.has(row.id),
  };
}

/** The client's current coach, when known: their user id and first name. */
export type CurrentCoach = { id: string; firstName: string };

/** What History saves on the phone, so it opens without signal. */
export type HistoryData = { logs: HistoryLog[]; prs: PrEvent[]; streak: number };

export type HistoryRow = { id: string; dow: string; num: number; name: string; meta: string; pr: boolean; label: string };

/** `coach` names the coach only on workouts that coach logged; any other logger reads "your coach". */
export function historyRow(log: HistoryLog, units: Units, coach: CurrentCoach | null, timeZone: string): HistoryRow {
  const by = coach && log.loggedBy === coach.id ? coach.firstName : 'your coach';
  const day = localDateOf(log.finishedAt, timeZone);
  const meta = [
    log.loggedByCoach ? `Logged by ${by}` : null,
    formatLogDuration(log.durationS),
    log.volumeKg > 0 ? formatLogVolume(log.volumeKg, units) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: log.id,
    dow: weekdayShort(day),
    num: Number(day.slice(8, 10)),
    name: log.name,
    meta,
    pr: log.pr,
    label: [log.name, formatDayLabel(day), meta, log.pr ? 'personal record' : null].filter(Boolean).join(', '),
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type MonthSummary = { title: string; workouts: number; time: string; prs: number };

/** This month so far (the month `today` is in, each workout's day read in `timeZone`). */
export function monthSummary(logs: readonly HistoryLog[], prs: readonly PrEvent[], today: IsoDate, timeZone: string): MonthSummary {
  const month = today.slice(0, 7);
  const mine = logs.filter((l) => localDateOf(l.finishedAt, timeZone).startsWith(month));
  const seconds = mine.reduce((s, l) => s + l.durationS, 0);
  return {
    title: `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} so far`,
    workouts: mine.length,
    time: mine.length === 0 ? '0 min' : formatLogDurationShort(seconds),
    prs: liftsImprovedBetween(prs, `${month}-01`, today, timeZone),
  };
}

const isLog = (v: unknown): v is HistoryLog => {
  const l = v as HistoryLog;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.finishedAt === 'string' &&
    typeof l.durationS === 'number' &&
    typeof l.volumeKg === 'number' &&
    typeof l.loggedByCoach === 'boolean' &&
    (l.loggedBy === null || typeof l.loggedBy === 'string') &&
    typeof l.pr === 'boolean'
  );
};

const isPr = (v: unknown): v is PrEvent => {
  const p = v as PrEvent;
  return typeof v === 'object' && v !== null && typeof p.logId === 'string' && typeof p.exerciseId === 'string' && typeof p.achievedAt === 'string';
};

/** The saved copy, or null when there is none or it is not readable. */
export function parseHistoryCache(raw: string | null): HistoryData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HistoryData>;
    if (!Array.isArray(v.logs) || !v.logs.every(isLog)) return null;
    if (!Array.isArray(v.prs) || !v.prs.every(isPr)) return null;
    return { logs: v.logs, prs: v.prs, streak: typeof v.streak === 'number' ? v.streak : 0 };
  } catch {
    return null;
  }
}
