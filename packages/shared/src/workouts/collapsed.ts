import { formatClock, formatDistance, formatWeight, kgToInput, toKg } from '../units/units';
import type { Units } from '../units/units';
import { setShowsRest } from './doc-ops';
import type { WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from './schema';
import { targetFieldsFor } from './targets';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "8" or "8–10" from already formatted ends: one text when both ends read the same. */
function span(lo: string, hi: string): string {
  return lo === hi ? lo : `${lo}–${hi}`;
}

/** The lowest and highest of the values present, or null when none is. */
function bounds(values: ReadonlyArray<number | null>): [number, number] | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : [Math.min(...present), Math.max(...present)];
}

function weightSpan(sets: readonly WorkoutSetDoc[], units: Units): string | null {
  const b = bounds(sets.map((s) => s.targetWeightKg));
  if (!b) return null;
  const lo = formatWeight(b[0], units);
  const hi = formatWeight(b[1], units);
  // "22–24 kg": the unit once, after the top.
  return lo === hi ? hi : `${lo.slice(0, -(units.length + 1))}–${hi}`;
}

function repsSpan(sets: readonly WorkoutSetDoc[]): string | null {
  const lo = bounds(sets.map((s) => s.targetRepsMin ?? s.targetRepsMax));
  const hi = bounds(sets.map((s) => s.targetRepsMax ?? s.targetRepsMin));
  if (!lo || !hi) return null;
  return span(String(lo[0]), String(hi[1]));
}

function clockSpan(values: ReadonlyArray<number | null>): string | null {
  const b = bounds(values);
  return b ? span(formatClock(b[0]), formatClock(b[1])) : null;
}

/** "rest 1:30" or "rest 1:00–1:30" from the rests that are more than nothing; null when there are none. */
function restText(rests: readonly number[]): string | null {
  const t = clockSpan(rests.filter((r) => r > 0));
  return t ? `rest ${t}` : null;
}

/** The sets the line is about: the working sets (normal and to failure), else every set that isn't a drop. */
function workingSets(sets: readonly WorkoutSetDoc[]): WorkoutSetDoc[] {
  const normal = sets.filter((s) => s.setType === 'normal');
  return normal.length > 0 ? normal : sets.filter((s) => s.setType !== 'drop');
}

/**
 * The one line a folded exercise shows in the builder on a phone, under its name: "4 × 8 @ 60 kg · rest 1:30".
 * Differing sets read as ranges ("3 × 8–10 @ 22–24 kg"); warm-ups are counted in front ("1 warm-up + 3 × 8"), and
 * failure sets, drop sets, the rest, the tempo and substitutes follow. Time and distance read as "3 × 0:45" and
 * "2 × 400 m"; with no target filled in it is just "3 sets". When only some sets are filled in, the count is of those
 * and the rest are named ("1 × 10 @ 27.5 kg + 2 empty sets"), so a half-done exercise doesn't read as finished.
 * `rest: false` leaves the rest out (a superset shows the rest after each round once, for the whole block).
 */
export function exerciseCollapsedLine(
  exercise: Pick<WorkoutExerciseDoc, 'sets' | 'trackingType' | 'eachSide' | 'tempo'> & { substitutes?: readonly unknown[] },
  units: Units,
  opts: { rest?: boolean } = {},
): string {
  const fields = targetFieldsFor(exercise.trackingType);
  const all = workingSets(exercise.sets);
  // A set with no target the tracking type uses (and not to failure) is still empty: it isn't counted in "3 × 8".
  const isEmpty = (s: WorkoutSetDoc) =>
    !s.toFailure &&
    (!fields.includes('reps') || (s.targetRepsMin === null && s.targetRepsMax === null)) &&
    (!fields.includes('weight') || s.targetWeightKg === null) &&
    (!fields.includes('duration') || s.targetDurationS === null) &&
    (!fields.includes('distance') || s.targetDistanceM === null);
  const filled = all.filter((s) => !isEmpty(s));
  // Nothing filled in yet reads as plain "3 sets".
  const working = filled.length > 0 ? filled : all;
  const empty = all.length - working.length;
  const warmups = exercise.sets.filter((s) => s.setType === 'warmup').length;
  const hasNormal = exercise.sets.some((s) => s.setType === 'normal');
  const drops = exercise.sets.filter((s) => s.setType === 'drop').length;
  const failures = working.filter((s) => s.toFailure);
  const allFailure = failures.length > 0 && failures.length === working.length;
  const counted = working.filter((s) => !s.toFailure);

  const main: string[] = [];
  if (fields.includes('reps')) {
    const reps = allFailure ? 'to failure' : repsSpan(counted);
    if (reps) main.push(reps);
  } else if (allFailure) main.push('to failure');
  if (fields.includes('duration')) {
    const t = clockSpan(working.map((s) => s.targetDurationS));
    if (t) main.push(t);
  }
  if (fields.includes('distance')) {
    const b = bounds(working.map((s) => s.targetDistanceM));
    if (b) main.push(span(formatDistance(b[0], units), formatDistance(b[1], units)));
  }

  let head = main.length > 0 ? `${working.length} × ${main.join(', ')}` : plural(working.length, 'set');
  if (exercise.eachSide) head += ' each side';
  const weight = fields.includes('weight') ? weightSpan(working, units) : null;
  if (weight) head += ` @ ${weight}`;
  if (empty > 0) head += ` + ${plural(empty, 'empty set')}`;
  if (warmups > 0 && hasNormal) head = `${plural(warmups, 'warm-up')} + ${head}`;

  const parts = [head];
  if (failures.length > 0 && !allFailure) {
    const lastIsFailure = failures.length === 1 && working[working.length - 1]?.toFailure === true;
    parts.push(lastIsFailure ? 'last to failure' : `${failures.length} to failure`);
  }
  if (drops > 0) parts.push(plural(drops, 'drop set'));
  if (opts.rest !== false) {
    const rest = restText(all.map((s) => s.restSeconds));
    if (rest) parts.push(rest);
  }
  if (exercise.tempo) parts.push(`tempo ${exercise.tempo}`);
  const subs = exercise.substitutes?.length ?? 0;
  if (subs > 0) parts.push(plural(subs, 'substitute'));
  return parts.join(' · ');
}

/** A folded block: its title, one line, and for a superset or pick-one group one line per exercise. */
export type CollapsedBlock = { title: string; line: string; parts: Array<{ key: string; name: string; line: string }> };

/**
 * What a folded block shows in the builder on a phone. A straight exercise: its name and exerciseCollapsedLine. A
 * superset: "Superset / circuit", "3 rounds · rest 1:30" (or "3 + 2 sets" when uneven) and each exercise's line
 * without rest. A pick-one group: "Pick one", "2 options" and each option's line.
 */
export function blockCollapsedSummary(block: WorkoutBlockDoc, units: Units): CollapsedBlock {
  const first = block.exercises[0];
  if (block.kind === 'straight' || !first) {
    return { title: first?.exerciseName ?? '', line: first ? exerciseCollapsedLine(first, units) : '', parts: [] };
  }
  if (block.kind === 'choice') {
    return {
      title: 'Pick one',
      line: plural(block.exercises.length, 'option'),
      parts: block.exercises.map((e) => ({ key: e.id, name: e.exerciseName, line: exerciseCollapsedLine(e, units) })),
    };
  }
  const counts = block.exercises.map((e) => e.sets.filter((s) => s.setType !== 'drop').length);
  const even = counts.every((c) => c === counts[0]);
  const rests = block.exercises.flatMap((e, ei) =>
    e.sets.flatMap((s, si) => (s.setType !== 'drop' && s.setType !== 'warmup' && setShowsRest(block, ei, si) ? [s.restSeconds] : [])),
  );
  const line = [even ? plural(counts[0]!, 'round') : `${counts.join(' + ')} sets`, restText(rests)].filter(Boolean).join(' · ');
  return {
    title: 'Superset / circuit',
    line,
    parts: block.exercises.map((e) => ({ key: e.id, name: e.exerciseName, line: exerciseCollapsedLine(e, units, { rest: false }) })),
  };
}

const MAX_REPS = 1000;
const MAX_WEIGHT_KG = 1000;

/** The +/− on a reps box: one rep at a time, from 1 to 1000. + on an empty box gives 1; − on an empty box stays empty. */
export function stepReps(reps: number | null, dir: 1 | -1): number | null {
  if (reps === null) return dir === 1 ? 1 : null;
  return Math.max(1, Math.min(MAX_REPS, reps + dir));
}

/** How much one tap on a weight's +/− changes it, in the coach's units: 2.5 kg or 5 lb. */
export function weightStep(units: Units): number {
  return units === 'kg' ? 2.5 : 5;
}

/**
 * The +/− on a weight box: the next step up or down in the coach's units (61 kg goes to 62.5 or 60, so it lands on
 * the plates), never below 0 or above 1000 kg. Takes and gives kilograms, as the doc stores them. + on an empty box
 * gives one step; − on an empty box stays empty.
 */
export function stepWeight(kg: number | null, dir: 1 | -1, units: Units): number | null {
  const step = weightStep(units);
  if (kg === null) return dir === 1 ? toKg(step, units) : null;
  const v = kgToInput(kg, units);
  const eps = 1e-9;
  const next = dir === 1 ? Math.floor(v / step + eps) * step + step : Math.ceil(v / step - eps) * step - step;
  const out = toKg(Math.max(0, next), units);
  return out > MAX_WEIGHT_KG ? kg : out;
}
