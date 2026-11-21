import { isMuscleId, type MuscleId } from '../anatomy/muscles';
import type { TrackingType } from '../exercises/tracking';
import type { WorkoutBlockDoc, WorkoutDoc, WorkoutExerciseDoc } from '../workouts/schema';
import { targetFieldsFor } from '../workouts/targets';
import { DOSE_LIMITS, type CorrectiveDirection, type CorrectiveDose } from './correctives';
import type { ConfirmedGroup, MarkSide } from './marks';
import { findingRule, type EvidenceLevel } from './rules';

/**
 * Exercises per confirmed muscle (board AS5) and the suggested corrective workout they make (AS5b).
 *
 * Options for a group (one confirmed muscle and status): the coach's own corrective exercises tagged to that muscle,
 * a side the group has, and the matching direction (under → strengthen, over → release / stretch) come first, marked
 * "Yours"; then built-in defaults, the ones the group's findings recommend first, with their evidence. 2–4 options:
 * built-ins fill up to four (at least one is always offered when there is one).
 */

/** A muscle tag of a corrective exercise: a muscle group on one side ('none' for abs). */
export type MuscleTag = { muscleId: MuscleId; side: MarkSide };

/** A corrective exercise ready to offer: the coach's own (corrective_exercises) or a built-in found in the library. */
export type CorrectiveChoice = {
  exerciseId: string;
  name: string;
  trackingType: TrackingType;
  imagePath: string | null;
  direction: CorrectiveDirection;
  muscles: readonly MuscleTag[];
  dose: CorrectiveDose;
  /** The coach's own (corrective_exercises.id), or null for a built-in. */
  correctiveId: string | null;
  /** Built-ins only. */
  builtinKey: string | null;
  evidence: EvidenceLevel | null;
};

export type ExerciseOption = CorrectiveChoice & {
  yours: boolean;
  /** For a recommended built-in, the finding it is for ("knees cave in"). */
  forLabel: string | null;
};

export type OptionGroup = ConfirmedGroup & { options: ExerciseOption[] };

export const MAX_OPTIONS = 4;

const lowerFirst = (s: string) => (/^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

function tagged(choice: CorrectiveChoice, g: ConfirmedGroup): boolean {
  return choice.direction === g.status && choice.muscles.some((t) => t.muscleId === g.muscleId && g.sides.includes(t.side));
}

/**
 * The options of each group. `coach` are the coach's own (any order: kept as given), `builtins` the built-ins found in
 * the library (BUILTIN_CORRECTIVES order); `labels` names each checkpoint ("Knees cave in"). A built-in whose exercise
 * the coach also tagged shows once, as theirs.
 */
export function exerciseOptions(
  groups: readonly ConfirmedGroup[],
  coach: readonly CorrectiveChoice[],
  builtins: readonly CorrectiveChoice[],
  labels: Readonly<Record<string, string>> = {},
): OptionGroup[] {
  return groups.map((g) => {
    const yours = coach.filter((c) => tagged(c, g)).map((c): ExerciseOption => ({ ...c, yours: true, forLabel: null }));
    const taken = new Set(yours.map((o) => o.exerciseId));
    // Rank a built-in by where the group's findings recommend it (best first); not recommended = after, list order.
    const rank = (key: string | null): { at: number; source: string | null } => {
      let best = { at: Number.POSITIVE_INFINITY, source: null as string | null };
      for (const s of g.sources) {
        const i = key ? (findingRule(s)?.exercises.indexOf(key) ?? -1) : -1;
        if (i >= 0 && i < best.at) best = { at: i, source: s };
      }
      return best;
    };
    const ranked = builtins
      .filter((b) => tagged(b, g) && !taken.has(b.exerciseId))
      .map((b, i) => ({ b, i, r: rank(b.builtinKey) }))
      .sort((x, y) => x.r.at - y.r.at || x.i - y.i);
    const room = Math.max(1, MAX_OPTIONS - yours.length);
    const builtinOptions = ranked.slice(0, room).map(({ b, r }): ExerciseOption => ({
      ...b,
      yours: false,
      forLabel: r.source ? lowerFirst(labels[r.source] ?? '') || null : null,
    }));
    return { ...g, options: [...yours, ...builtinOptions] };
  });
}

/** A pick: an exercise chosen for one muscle and status, in the order picked within the group. */
export type CorrectivePick = { muscleId: MuscleId; status: 'over' | 'under'; exerciseId: string };

/** Before the coach picks: all their own options, or the top built-in where they have none (board AS5 note 2). */
export function defaultPicks(groups: readonly OptionGroup[]): CorrectivePick[] {
  return groups.flatMap((g) => {
    const yours = g.options.filter((o) => o.yours);
    const chosen = yours.length > 0 ? yours : g.options.slice(0, 1);
    return chosen.map((o) => ({ muscleId: g.muscleId, status: g.status, exerciseId: o.exerciseId }));
  });
}

/** The picks that still fit the options (a mark un-confirmed or a tag removed drops its picks), in group order. */
export function livePicks(groups: readonly OptionGroup[], picks: readonly CorrectivePick[]): CorrectivePick[] {
  return groups.flatMap((g) =>
    picks.filter((p) => p.muscleId === g.muscleId && p.status === g.status && g.options.some((o) => o.exerciseId === p.exerciseId)),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PICKS = 60;

/** The picks a save sends, checked (the database checks again), or null. */
export function checkPicks(input: unknown): CorrectivePick[] | null {
  if (!Array.isArray(input) || input.length > MAX_PICKS) return null;
  const seen = new Set<string>();
  const out: CorrectivePick[] = [];
  for (const raw of input as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isMuscleId(p.muscleId) || (p.status !== 'over' && p.status !== 'under') || typeof p.exerciseId !== 'string' || !UUID.test(p.exerciseId)) return null;
    const key = `${p.muscleId}|${p.status}|${p.exerciseId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ muscleId: p.muscleId, status: p.status, exerciseId: p.exerciseId });
  }
  return out;
}

/** Rest between sets of a corrective exercise in the suggested workout (board AS5b: 0:45). */
export const CORRECTIVE_REST_S = 45;
const MAX_BLOCKS = 30;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** One exercise of the workout, its sets filled in from the dose where the exercise's measurements allow it. */
function exerciseFor(choice: CorrectiveChoice, makeId: () => string): WorkoutExerciseDoc {
  const fields = targetFieldsFor(choice.trackingType);
  const sets = clamp(choice.dose.sets, 1, DOSE_LIMITS.sets);
  const reps = fields.includes('reps') && choice.dose.reps !== null ? clamp(choice.dose.reps, 1, DOSE_LIMITS.reps) : null;
  const duration = fields.includes('duration') && choice.dose.seconds !== null ? clamp(choice.dose.seconds, 1, DOSE_LIMITS.seconds) : null;
  return {
    id: makeId(),
    exerciseId: choice.exerciseId,
    exerciseName: choice.name,
    trackingType: choice.trackingType,
    note: null,
    eachSide: choice.dose.eachSide,
    tempo: null,
    substitutes: [],
    sets: Array.from({ length: sets }, () => ({
      id: makeId(),
      setType: 'normal' as const,
      targetRepsMin: reps,
      targetRepsMax: reps,
      targetWeightKg: null,
      targetDurationS: duration,
      targetDistanceM: null,
      toFailure: false,
      restSeconds: CORRECTIVE_REST_S,
      note: null,
    })),
  };
}

/**
 * The suggested workout (AS5b): every pick in order (groups in order, then the order picked), each exercise once, as
 * straight sets with sets and reps (or seconds) from its default and 45 s rest. Nothing is saved: it opens in the
 * normal workout builder. Null when nothing is picked.
 */
export function buildSuggestedWorkout(input: {
  name: string;
  groups: readonly OptionGroup[];
  picks: readonly CorrectivePick[];
  makeId: () => string;
}): WorkoutDoc | null {
  const seen = new Set<string>();
  const blocks: WorkoutBlockDoc[] = [];
  for (const p of livePicks(input.groups, input.picks)) {
    if (seen.has(p.exerciseId) || blocks.length >= MAX_BLOCKS) continue;
    const choice = input.groups.find((g) => g.muscleId === p.muscleId && g.status === p.status)?.options.find((o) => o.exerciseId === p.exerciseId);
    if (!choice) continue;
    seen.add(p.exerciseId);
    blocks.push({ id: input.makeId(), sectionId: null, kind: 'straight', exercises: [exerciseFor(choice, input.makeId)] });
  }
  if (blocks.length === 0) return null;
  return { id: input.makeId(), name: input.name.slice(0, 100), notes: null, sections: [], blocks };
}

/** "Corrective – Vaishali". */
export function suggestedWorkoutName(firstName: string): string {
  const name = firstName.trim();
  return name ? `Corrective – ${name}` : 'Corrective';
}
