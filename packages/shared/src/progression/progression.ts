// Automatic progression (docs/superpowers/specs/2026-11-07-auto-progression-design.md). Progression never rewrites
// a workout plan: it only changes the SUGGESTED weight (the phone's pre-fill and what the coach sees), worked out here
// from the client's last completed sessions of an exercise.
import type { TrackingType } from '../exercises/tracking';
import type { ResultSet } from '../logs/format';
import type { LogExerciseDoc, WorkoutLogDoc } from '../logs/schema';
import { fromKg, toKg, type Units } from '../units/units';
import type { SetType, WorkoutDoc, WorkoutExerciseDoc } from '../workouts/schema';

export type BodyRegion = 'upper' | 'lower';

/** free-exercise-db muscle names that make an exercise lower body (+10 lb / +5 kg). */
const LOWER_BODY_MUSCLES = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'lower back']);

/** Lower body when any primary muscle is a leg or hip muscle; everything else, unknown included, is upper body. */
export function exerciseRegion(primaryMuscles: readonly string[]): BodyRegion {
  return primaryMuscles.some((m) => LOWER_BODY_MUSCLES.has(m.trim().toLowerCase())) ? 'lower' : 'upper';
}

export type ProgressionSet = { setType: SetType; completed: boolean; reps: number | null; weightKg: number | null };
/** One completed log's sets of an exercise, in order (done and not done). */
export type ProgressionSession = { sets: readonly ProgressionSet[] };
/** An exercise's recent sessions, most recent first, and its body region. */
export type ExerciseHistory = { region: BodyRegion; sessions: readonly ProgressionSession[] };
export type ProgressionHistory = Record<string, ExerciseHistory>;

export type PrescribedSet = { setType: SetType; repsMin: number | null; repsMax: number | null; weightKg: number | null };
export type Prescription = { trackingType: TrackingType; sets: readonly PrescribedSet[] };

export type Suggestion = {
  change: 'up' | 'down';
  /** The heaviest working weight of the last session. */
  fromWeightKg: number;
  weightKg: number;
  /** The change in the client's units (+5, −15), for the hint. */
  delta: number;
};

const STEP: Record<Units, Record<BodyRegion, number>> = { lb: { upper: 5, lower: 10 }, kg: { upper: 2.5, lower: 5 } };
const PLATE: Record<Units, number> = { lb: 5, kg: 2.5 };
const DELOAD = 0.9;

type Range = { bottom: number; top: number };

const working = <T extends { setType: SetType }>(sets: readonly T[]): T[] => sets.filter((s) => s.setType === 'normal');

/** Each planned working set's rep range, or null when any has no rep target. */
function ranges(p: Prescription): Range[] | null {
  const out: Range[] = [];
  for (const s of working(p.sets)) {
    const bottom = s.repsMin ?? s.repsMax;
    const top = s.repsMax ?? s.repsMin;
    if (bottom === null || top === null) return null;
    out.push({ bottom, top });
  }
  return out.length > 0 ? out : null;
}

/** The nth working set's range; extra sets the client added use the last planned one. */
const rangeAt = (r: Range[], n: number): Range => r[Math.min(n, r.length - 1)]!;

function allAtTop(s: ProgressionSession, r: Range[]): boolean {
  const sets = working(s.sets);
  return sets.length > 0 && sets.every((x, n) => x.completed && x.reps !== null && x.reps >= rangeAt(r, n).top);
}

function missedBottom(s: ProgressionSession, r: Range[]): boolean {
  return working(s.sets).some((x, n) => x.completed && x.reps !== null && x.reps < rangeAt(r, n).bottom);
}

/**
 * The next suggested weight for one exercise, or null to keep today's pre-fill (hold, or nothing to go on).
 * - Up: every working set of the last session done at (or above) the top of its range: +5 lb upper / +10 lb lower
 *   (+2.5 kg / +5 kg), on the last session's heaviest working weight.
 * - Down: the last two sessions each had a done working set below the bottom of its range: −10%, rounded to the
 *   nearest 5 lb / 2.5 kg.
 * Only weight-and-reps exercises with a rep range on every working set and a weight lifted last time qualify, and a
 * weight the coach typed on any working set always wins (no suggestion).
 */
export function nextSuggestion(
  history: readonly ProgressionSession[],
  prescription: Prescription,
  region: BodyRegion,
  units: Units,
): Suggestion | null {
  if (prescription.trackingType !== 'weight_reps') return null;
  if (working(prescription.sets).some((s) => s.weightKg !== null)) return null;
  const r = ranges(prescription);
  const last = history[0];
  if (!r || !last) return null;
  const lifted = working(last.sets).filter((s) => s.completed && s.weightKg !== null && s.weightKg > 0);
  if (lifted.length === 0) return null;
  const fromWeightKg = Math.max(...lifted.map((s) => s.weightKg!));
  const from = fromKg(fromWeightKg, units);

  if (allAtTop(last, r)) {
    const delta = STEP[units][region];
    return { change: 'up', fromWeightKg, weightKg: toKg(from + delta, units), delta };
  }
  const before = history[1];
  if (before && missedBottom(last, r) && missedBottom(before, r)) {
    const plate = PLATE[units];
    const to = Math.round((from * DELOAD) / plate) * plate;
    if (to <= 0 || to >= from) return null;
    return { change: 'down', fromWeightKg, weightKg: toKg(to, units), delta: Math.round((to - from) * 10) / 10 };
  }
  return null;
}

/** "↑ +5 lb", "↓ −15 lb". */
export function progressionHint(s: Suggestion, units: Units): string {
  return s.delta >= 0 ? `↑ +${s.delta} ${units}` : `↓ −${-s.delta} ${units}`;
}

/**
 * Last time with the suggestion applied, for the shared pre-fill (resolveSetValues rule 6): every working set gets the
 * suggested weight (reps stay what was done). The coach's numbers and the client's own changes still come first.
 */
export function withSuggestion(lastTime: readonly ResultSet[], s: Suggestion | null): readonly ResultSet[] {
  if (!s) return lastTime;
  const out = lastTime.map((r) => (r.setType === 'normal' ? { ...r, actualWeightKg: s.weightKg } : r));
  if (!out.some((r) => r.setType === 'normal')) {
    out.push({ setType: 'normal', actualReps: null, actualWeightKg: s.weightKg, actualDurationS: null, actualDistanceM: null });
  }
  return out;
}

export function prescriptionOfLogExercise(ex: Pick<LogExerciseDoc, 'trackingType' | 'sets'>): Prescription {
  return {
    trackingType: ex.trackingType,
    sets: ex.sets.map((s) => ({ setType: s.setType, repsMin: s.target.repsMin, repsMax: s.target.repsMax, weightKg: s.target.weightKg })),
  };
}

export function prescriptionOfWorkoutExercise(ex: Pick<WorkoutExerciseDoc, 'trackingType' | 'sets'>): Prescription {
  return {
    trackingType: ex.trackingType,
    sets: ex.sets.map((s) => ({ setType: s.setType, repsMin: s.targetRepsMin, repsMax: s.targetRepsMax, weightKg: s.targetWeightKg })),
  };
}

const SET_TYPE_VALUES: readonly SetType[] = ['normal', 'warmup', 'drop'];
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * The rows of the progression_history database function, grouped per exercise id. Rows arrive ordered by exercise,
 * session (1 = most recent) and set; numbers may arrive as text.
 */
export function progressionHistoryFromRows(rows: unknown): ProgressionHistory {
  const out: Record<string, { region: BodyRegion; sessions: Array<{ sets: ProgressionSet[] }> }> = {};
  if (!Array.isArray(rows)) return out;
  for (const raw of rows as Array<Record<string, unknown>>) {
    const id = raw.exercise_id;
    const session = num(raw.session);
    const setType = raw.set_type as SetType;
    if (typeof id !== 'string' || session === null || session < 1 || !SET_TYPE_VALUES.includes(setType)) continue;
    const muscles = Array.isArray(raw.primary_muscles) ? raw.primary_muscles.filter((m): m is string => typeof m === 'string') : [];
    const entry = (out[id] ??= { region: exerciseRegion(muscles), sessions: [] });
    while (entry.sessions.length < session) entry.sessions.push({ sets: [] });
    entry.sessions[session - 1]!.sets.push({
      setType,
      completed: raw.completed === true,
      reps: num(raw.actual_reps),
      weightKg: num(raw.actual_weight_kg),
    });
  }
  return out;
}

/** Suggestions for every exercise of a log (pick-one options included), keyed by log exercise id. */
export function suggestionsForLog(log: Pick<WorkoutLogDoc, 'blocks'>, history: ProgressionHistory, units: Units): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  for (const ex of log.blocks.flatMap((b) => b.exercises)) {
    const h = history[ex.exerciseId];
    const s = h ? nextSuggestion(h.sessions, prescriptionOfLogExercise(ex), h.region, units) : null;
    if (s) out[ex.id] = s;
  }
  return out;
}

/** Suggestions for every exercise of a planned workout, keyed by workout exercise id (for the coach's views). */
export function suggestionsForWorkout(doc: Pick<WorkoutDoc, 'blocks'>, history: ProgressionHistory, units: Units): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  for (const ex of doc.blocks.flatMap((b) => b.exercises)) {
    const h = history[ex.exerciseId];
    const s = h ? nextSuggestion(h.sessions, prescriptionOfWorkoutExercise(ex), h.region, units) : null;
    if (s) out[ex.id] = s;
  }
  return out;
}
