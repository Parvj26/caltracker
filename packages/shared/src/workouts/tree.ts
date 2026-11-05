import type { TrackingType } from '../exercises/tracking';
import type { BlockKind, SetType, WorkoutDoc } from './schema';
import { TARGET_FIELDS } from './targets';

/**
 * PostgREST nested select for one workout with its blocks, exercises (and their names) and sets.
 * Embed order is not guaranteed, so workoutRowToDoc sorts every level by `position`.
 */
export const WORKOUT_TREE_SELECT =
  'id, name, notes, client_id, scheduled_on, ' +
  'workout_blocks(id, position, kind, ' +
  'workout_exercises(id, position, exercise_id, note, exercises(name, tracking_type), ' +
  'workout_sets(id, position, set_type, target_reps_min, target_reps_max, target_weight_kg, target_duration_s, ' +
  'target_distance_m, to_failure, rest_seconds, note)))';

/** Postgres `numeric` can arrive as a string (for example '61.235'), depending on the client. */
type Numeric = number | string | null;

export type WorkoutTreeSetRow = {
  id: string;
  position: number;
  set_type: SetType;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_weight_kg: Numeric;
  target_duration_s: number | null;
  target_distance_m: Numeric;
  to_failure: boolean;
  rest_seconds: number;
  note: string | null;
};

export type WorkoutTreeRow = {
  id: string;
  name: string;
  notes: string | null;
  client_id: string | null;
  scheduled_on: string | null;
  workout_blocks: Array<{
    id: string;
    position: number;
    kind: BlockKind;
    workout_exercises: Array<{
      id: string;
      position: number;
      exercise_id: string;
      note: string | null;
      exercises: { name: string; tracking_type: TrackingType } | null;
      workout_sets: WorkoutTreeSetRow[];
    }>;
  }>;
};

const byPosition = <T extends { position: number }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.position - b.position);

const num = (v: Numeric): number | null => (v === null ? null : Number(v));

export function workoutRowToDoc(row: WorkoutTreeRow): WorkoutDoc {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    blocks: byPosition(row.workout_blocks).map((b) => ({
      id: b.id,
      kind: b.kind,
      exercises: byPosition(b.workout_exercises).map((e) => {
        const trackingType = e.exercises?.tracking_type ?? 'weight_reps';
        // The tracking type is read live from the exercise, but the sets were written for whatever
        // type it had then. Drop targets the current type doesn't use, so the doc stays valid and
        // the coach can still open and save the workout after changing an exercise's type.
        const allowed = TARGET_FIELDS[trackingType];
        const keep = <T>(field: (typeof allowed)[number], v: T | null): T | null => (allowed.includes(field) ? v : null);
        return {
          id: e.id,
          exerciseId: e.exercise_id,
          exerciseName: e.exercises?.name ?? '',
          trackingType,
          note: e.note,
          sets: byPosition(e.workout_sets).map((s) => ({
            id: s.id,
            setType: s.set_type,
            targetRepsMin: keep('reps', s.target_reps_min),
            targetRepsMax: keep('reps', s.target_reps_max),
            targetWeightKg: keep('weight', num(s.target_weight_kg)),
            targetDurationS: keep('duration', s.target_duration_s),
            targetDistanceM: keep('distance', num(s.target_distance_m)),
            toFailure: s.to_failure,
            restSeconds: s.rest_seconds,
            note: s.note,
          })),
        };
      }),
    })),
  };
}
