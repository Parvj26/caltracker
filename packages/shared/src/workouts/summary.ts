import { formatClock, formatDistance, formatWeight } from '../units/units';
import type { Units } from '../units/units';
import type { WorkoutDoc, WorkoutExerciseDoc, WorkoutSetDoc } from './schema';
import { targetFieldsFor } from './targets';

/** One row of a workout's summary card: the exercise (or pick-one group) and its one-line summary. */
export type WorkoutSummaryRow = { key: string; name: string; line: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The set that speaks for the exercise: the heaviest working set that isn't to failure (the last of equals), so a
 * warm-up and a ramp read as the top set ("5 reps · 75 lb"). Falls back to any working set, then any set.
 */
function topSet(sets: readonly WorkoutSetDoc[]): WorkoutSetDoc | undefined {
  const working = sets.filter((s) => s.setType === 'normal');
  const pool = [working.filter((s) => !s.toFailure), working, sets.filter((s) => s.setType !== 'drop'), [...sets]].find(
    (p) => p.length > 0,
  );
  if (!pool) return undefined;
  return pool.reduce((best, s) => ((s.targetWeightKg ?? -1) >= (best.targetWeightKg ?? -1) ? s : best));
}

/**
 * One line for an exercise on a workout's summary card: "4 sets · 5 reps · 75 lb", "3 sets · 0:45", "1 set · 8–10
 * reps". The count leaves out drop sets (a drop continues the set before it); the targets are the top set's.
 */
export function exerciseSummaryLine(exercise: Pick<WorkoutExerciseDoc, 'sets' | 'trackingType'>, units: Units): string {
  const parts = [plural(exercise.sets.filter((s) => s.setType !== 'drop').length, 'set')];
  const set = topSet(exercise.sets);
  if (!set) return parts[0]!;
  const fields = targetFieldsFor(exercise.trackingType);
  if (fields.includes('reps') || set.toFailure) {
    const min = set.targetRepsMin ?? set.targetRepsMax;
    const max = set.targetRepsMax ?? set.targetRepsMin;
    if (set.toFailure) parts.push('to failure');
    else if (min !== null && max !== null) parts.push(min === max ? plural(min, 'rep') : `${min}–${max} reps`);
  }
  if (fields.includes('weight') && set.targetWeightKg !== null) parts.push(formatWeight(set.targetWeightKg, units));
  if (fields.includes('duration') && set.targetDurationS !== null) parts.push(formatClock(set.targetDurationS));
  if (fields.includes('distance') && set.targetDistanceM !== null) parts.push(formatDistance(set.targetDistanceM, units));
  return parts.join(' · ');
}

/**
 * A workout's exercises for its summary card, in order: one row per exercise, and a pick-one group as one row
 * ("Pick one: Leg Press or Hack Squat", summarised by its first option), since the client does only one of them.
 */
export function workoutSummaryRows(doc: Pick<WorkoutDoc, 'blocks'>, units: Units): WorkoutSummaryRow[] {
  const rows: WorkoutSummaryRow[] = [];
  for (const block of doc.blocks) {
    const [first] = block.exercises;
    if (block.kind === 'choice') {
      if (first) {
        rows.push({
          key: block.id,
          name: `Pick one: ${block.exercises.map((e) => e.exerciseName).join(' or ')}`,
          line: exerciseSummaryLine(first, units),
        });
      }
      continue;
    }
    for (const e of block.exercises) rows.push({ key: e.id, name: e.exerciseName, line: exerciseSummaryLine(e, units) });
  }
  return rows;
}
