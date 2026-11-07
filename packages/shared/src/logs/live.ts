// The coach's "watching live" view of a workout in progress: where the client is, the header's numbers, and each
// exercise's set line. Pure, so the dashboard and any later phone view word it the same way.
import { awardPrEvents } from '../awards/week-prs';
import { toTrackingType } from '../exercises/tracking';
import { formatClock, fromKg } from '../units/units';
import type { Units } from '../units/units';
import { formatSetsSummary } from '../workouts/targets';
import { blockRoundCount, currentStep, liveExercises, needsPick } from './flow';
import { formatResult, stepName } from './format';
import type { LogExerciseDoc, LogSetDoc, WorkoutLogDoc } from './schema';
import { completedSetCount, logVolumeKg, openSetCount } from './summary';

/** Where the client is in the workout, for the "ON NOW" section and the "<NAME> IS HERE" exercise. */
export type LivePosition = {
  blockIndex: number;
  /** The log exercise they are on; null for a pick-one group they have not picked from yet. */
  exerciseId: string | null;
  /** The superset round they are on (1-based) and how many there are; null outside a superset. */
  round: number | null;
  rounds: number | null;
  /** The most recently ticked set of the whole workout, or null before the first tick. */
  lastTicked: { exerciseId: string; setIndex: number; completedAt: string } | null;
};

type Entry = { blockIndex: number; exercise: LogExerciseDoc | null };

/** Every exercise being done, in log order; a pick-one group not yet picked is one entry with no exercise. */
function entries(log: WorkoutLogDoc): Entry[] {
  return log.blocks.flatMap((block, blockIndex) =>
    needsPick(block) ? [{ blockIndex, exercise: null }] : liveExercises(block).map(({ exercise }) => ({ blockIndex, exercise })),
  );
}

const hasOpenSet = (e: Entry) => e.exercise === null || e.exercise.sets.some((s) => s.completedAt === null);

/**
 * Where they are: starting at the exercise of the most recently ticked set (the first exercise before any tick), the
 * first exercise that still has unticked sets, wrapping round to the start when everything after it is done. So a
 * client who skipped ahead is shown where they went, and one who just finished an exercise is shown on the next.
 * Null once every set is ticked.
 */
export function whereTheyAre(log: WorkoutLogDoc): LivePosition | null {
  const list = entries(log);
  let lastTicked: LivePosition['lastTicked'] = null;
  let lastMs = -Infinity;
  let start = 0;
  list.forEach((entry, k) => {
    entry.exercise?.sets.forEach((s, setIndex) => {
      if (s.completedAt === null) return;
      const ms = Date.parse(s.completedAt);
      // A tie goes to the later set in the workout (Mark all ticks a whole block at one time).
      if (ms >= lastMs) {
        lastMs = ms;
        lastTicked = { exerciseId: entry.exercise!.id, setIndex, completedAt: s.completedAt };
        start = k;
      }
    });
  });
  const order = [...list.slice(start), ...list.slice(0, start)];
  const here = order.find(hasOpenSet);
  if (!here) return null;
  const block = log.blocks[here.blockIndex]!;
  const superset = block.kind === 'superset';
  const rounds = superset ? blockRoundCount(block) : null;
  return {
    blockIndex: here.blockIndex,
    exerciseId: here.exercise?.id ?? null,
    round: superset ? (currentStep(block)?.round ?? rounds) : null,
    rounds,
    lastTicked,
  };
}

export type LiveStats = {
  done: number;
  total: number;
  /** Volume by the shared rule (logVolumeKg); format it with formatTotalWeight. */
  volumeKg: number;
  /** Lifts with a personal record in the award (once each), when the workout has an award. */
  prCount: number;
  prExerciseIds: string[];
  /** done / total, 0 to 1, for the progress bar. */
  fraction: number;
};

/** The live header's numbers. `award` is the stored awards.result (untyped jsonb), or null when there is none. */
export function liveStats(log: WorkoutLogDoc, award: unknown): LiveStats {
  const done = completedSetCount(log);
  const total = done + openSetCount(log);
  const prExerciseIds = [...new Set(awardPrEvents('', award).map((p) => p.exerciseId))];
  return { done, total, volumeKg: logVolumeKg(log), prCount: prExerciseIds.length, prExerciseIds, fraction: total === 0 ? 0 : done / total };
}

/** Time since the start as a clock ("32:14", "1:02:05"), never below zero. */
export function elapsedClock(startedAt: string, nowMs: number): string {
  return formatClock(Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 1000)));
}

function plannedText(set: LogSetDoc, ex: LogExerciseDoc, units: Units): string {
  const t = set.target;
  return formatSetsSummary(
    [
      {
        id: set.id,
        setType: set.setType,
        targetRepsMin: t.repsMin,
        targetRepsMax: t.repsMax,
        targetWeightKg: t.weightKg,
        targetDurationS: t.durationS,
        targetDistanceM: t.distanceM,
        toFailure: t.toFailure,
        restSeconds: t.restSeconds ?? 0,
        note: null,
      },
    ],
    toTrackingType(ex.trackingType),
    units,
  ).text;
}

/**
 * One exercise's sets as text: the ticked ones with what was actually done ("10 lb × 12"), then the ones still
 * planned, worded like the workout preview ("8 lb × 12").
 */
export function liveSetLine(ex: LogExerciseDoc, units: Units): { done: string[]; planned: string[] } {
  const tt = toTrackingType(ex.trackingType);
  const done: string[] = [];
  const planned: string[] = [];
  for (const s of ex.sets) {
    if (s.completedAt === null) {
      planned.push(plannedText(s, ex, units));
    } else {
      const text = formatResult({ reps: s.actualReps, weightKg: s.actualWeightKg, durationS: s.actualDurationS, distanceM: s.actualDistanceM }, tt, units);
      done.push(text ?? 'done');
    }
  }
  return { done, planned };
}

/** The right-hand count: "×3" before the first tick, "2/3" on the way, "3/3" when done ("Done" for a single set). */
export function exerciseProgressLabel(ex: Pick<LogExerciseDoc, 'sets'>): { text: string; state: 'todo' | 'partial' | 'done' } {
  const total = ex.sets.length;
  const done = ex.sets.filter((s) => s.completedAt !== null).length;
  if (done === 0) return { text: `×${total}`, state: 'todo' };
  if (done < total) return { text: `${done}/${total}`, state: 'partial' };
  return { text: total === 1 ? 'Done' : `${done}/${total}`, state: 'done' };
}

function ago(completedAt: string, nowMs: number): string {
  const s = Math.max(0, (nowMs - Date.parse(completedAt)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const signed = (n: number, unit: string) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`;

/** How a ticked set compares with its target: "+2 lb", "−2 reps", "as planned", or null when there is no target. */
function againstPlan(ex: LogExerciseDoc, set: LogSetDoc, units: Units): string | null {
  const tt = toTrackingType(ex.trackingType);
  const t = set.target;
  const parts: string[] = [];
  let compared = false;
  if ((tt === 'weight_reps' || tt === 'weight_time') && t.weightKg !== null && set.actualWeightKg !== null) {
    compared = true;
    const diff = Math.round((fromKg(set.actualWeightKg, units) - fromKg(t.weightKg, units)) * 10) / 10;
    if (diff !== 0) parts.push(signed(diff, units));
  }
  if ((tt === 'weight_reps' || tt === 'reps') && set.actualReps !== null && !t.toFailure && (t.repsMin !== null || t.repsMax !== null)) {
    compared = true;
    const min = t.repsMin ?? t.repsMax!;
    const max = t.repsMax ?? t.repsMin!;
    const diff = set.actualReps > max ? set.actualReps - max : set.actualReps < min ? set.actualReps - min : 0;
    if (diff !== 0) parts.push(signed(diff, Math.abs(diff) === 1 ? 'rep' : 'reps'));
  }
  if ((tt === 'time' || tt === 'weight_time') && t.durationS !== null && set.actualDurationS !== null) {
    compared = true;
    const diff = set.actualDurationS - t.durationS;
    if (diff !== 0) parts.push(signed(diff, 's'));
  }
  if (!compared) return null;
  return parts.length === 0 ? 'as planned' : `${parts.join(', ')} on plan`;
}

/** "Set 2 ticked just now · +2 lb on plan" for a ticked set; null for one that is not ticked. */
export function tickNote(ex: LogExerciseDoc, setIndex: number, nowMs: number, units: Units): string | null {
  const set = ex.sets[setIndex];
  if (!set || set.completedAt === null) return null;
  const name = stepName(ex, setIndex).replace(/ of \d+$/, '');
  const plan = againstPlan(ex, set, units);
  return `${name} ticked ${ago(set.completedAt, nowMs)}${plan ? ` · ${plan}` : ''}`;
}

/** The "Training now" tabs in a steady order: who started first, then first name, then log id. */
export function orderTrainingTabs<T extends { logId: string; firstName: string; startedAt: string }>(tabs: readonly T[]): T[] {
  return [...tabs].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.firstName.localeCompare(b.firstName) || a.logId.localeCompare(b.logId),
  );
}
