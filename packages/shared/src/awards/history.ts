import type { WorkoutLogDoc } from '../logs/schema';
import { logVolumeKg } from '../logs/summary';
import type { AwardInput, AwardResult } from './award';
import { detectPrs, logBests } from './prs';
import type { PersonalRecord } from './prs';
import type { ClientStats } from './rare';
import { localDay, streakWeeks, weekKey } from './streak';

// Everything the award works out from a client's whole log history. The award-workout Edge Function loads the
// client's completed logs and hands them here, so a retry, a catch-up out of order or a coach correction all
// give the same personal bests and stats.

/** The zone if Intl accepts it, otherwise UTC (an unknown or empty zone must never stop an award). */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

const recordKey = (r: PersonalRecord) =>
  r.kind === 'reps_at_weight' ? `${r.exerciseId}|${r.kind}|${r.valueKg}` : `${r.exerciseId}|${r.kind}`;

const beats = (cand: PersonalRecord, cur: PersonalRecord) =>
  cand.kind === 'reps_at_weight' ? (cand.reps ?? 0) > (cur.reps ?? 0) : cand.valueKg > cur.valueKg;

/**
 * The stored bests after this log: one per exercise for heaviest and e1rm, one per exercise and weight for
 * reps_at_weight. A tie keeps the earlier record.
 */
export function mergeRecords(history: readonly PersonalRecord[], log: WorkoutLogDoc): PersonalRecord[] {
  const byKey = new Map(history.map((r) => [recordKey(r), r]));
  for (const cand of logBests(log)) {
    const key = recordKey(cand);
    const cur = byKey.get(key);
    if (!cur || beats(cand, cur)) byKey.set(key, cand);
  }
  return [...byKey.values()];
}

/** Exercises in the log with no stored record yet: their first log is a baseline, not a PR. */
export function firstLogExercises(log: WorkoutLogDoc, history: readonly PersonalRecord[]): Set<string> {
  const known = new Set(history.map((r) => r.exerciseId));
  return new Set(logBests(log).map((r) => r.exerciseId).filter((id) => !known.has(id)));
}

const finishedFirst = (a: WorkoutLogDoc, b: WorkoutLogDoc) =>
  (a.finishedAt ?? '').localeCompare(b.finishedAt ?? '') || a.id.localeCompare(b.id);

/** Completed logs in the order they were finished (ties by id, so the order never changes between calls). */
function completedInOrder(logs: readonly WorkoutLogDoc[]): WorkoutLogDoc[] {
  return logs.filter((l) => l.status === 'completed' && l.finishedAt !== null).sort(finishedFirst);
}

/** Replays the completed logs in finish order: the PRs each one set, and the bests at the end. */
export function replayRecords(logs: readonly WorkoutLogDoc[]): {
  records: PersonalRecord[];
  prs: Map<string, PersonalRecord[]>;
} {
  let records: PersonalRecord[] = [];
  const prs = new Map<string, PersonalRecord[]>();
  for (const log of completedInOrder(logs)) {
    prs.set(log.id, detectPrs(log, records, firstLogExercises(log, records)));
    records = mergeRecords(records, log);
  }
  return { records, prs };
}

const countPrs = (prs: Map<string, PersonalRecord[]>) => [...prs.values()].reduce((n, p) => n + p.length, 0);

/**
 * The client's stats from these logs, as seen at `atIso` in their zone: the streak counts back from that week,
 * and the month volume is that calendar month's.
 */
export function clientStatsAt(
  logs: readonly WorkoutLogDoc[],
  timeZone: string,
  atIso: string,
  prCount: number,
): ClientStats {
  const done = completedInOrder(logs);
  const month = localDay(atIso, timeZone).slice(0, 7);
  let lifetime = 0;
  let monthly = 0;
  for (const l of done) {
    const v = logVolumeKg(l);
    lifetime += v;
    if (localDay(l.finishedAt as string, timeZone).slice(0, 7) === month) monthly += v;
  }
  const { current, best } = streakWeeks(
    done.map((l) => weekKey(l.finishedAt as string, timeZone)),
    weekKey(atIso, timeZone),
  );
  return {
    workouts: done.length,
    streak: current,
    bestStreak: best,
    prCount,
    lifetimeVolumeKg: Math.round(lifetime * 10) / 10,
    monthVolumeKg: Math.round(monthly * 10) / 10,
  };
}

export type AwardContext = Omit<AwardInput, 'owned' | 'rng'> & {
  /** The bests over every completed log: what personal_records should hold. */
  records: PersonalRecord[];
  /** The stats over every completed log, as of now: what client_stats should hold. */
  current: ClientStats;
};

/**
 * The award inputs for one log, judged against the logs finished before it (so a catch-up that runs out of order
 * still counts milestones and streak weeks where they fell), plus what the stored bests and stats become.
 */
export function awardContext(
  logs: readonly WorkoutLogDoc[],
  logId: string,
  timeZone: string,
  nowIso: string,
): AwardContext {
  const ordered = completedInOrder(logs);
  const i = ordered.findIndex((l) => l.id === logId);
  const log = ordered[i];
  if (!log || !log.finishedAt) throw new Error(`Log ${logId} is not a completed log of this client.`);
  const before = ordered.slice(0, i);
  const earlier = replayRecords(before);
  const all = replayRecords(ordered);
  const prsBefore = countPrs(earlier.prs);
  const own = all.prs.get(log.id) ?? [];
  return {
    log,
    prHistory: earlier.records,
    firstLogOfExercise: firstLogExercises(log, earlier.records),
    statsBefore: clientStatsAt(before, timeZone, log.finishedAt, prsBefore),
    statsAfter: clientStatsAt(ordered.slice(0, i + 1), timeZone, log.finishedAt, prsBefore + own.length),
    records: all.records,
    current: clientStatsAt(ordered, timeZone, nowIso, countPrs(all.prs)),
  };
}

/** The stickers an award adds one of, in reveal order. Only the ladder animal can be shiny. */
export function awardedStickers(r: AwardResult): Array<{ key: string; shiny: boolean }> {
  return [
    ...(r.ladder ? [{ key: r.ladder.key, shiny: r.ladder.shiny }] : []),
    ...(r.drop ? [{ key: r.drop, shiny: false }] : []),
    ...r.rare.map((key) => ({ key, shiny: false })),
    ...r.landmarks.map((key) => ({ key, shiny: false })),
  ];
}
