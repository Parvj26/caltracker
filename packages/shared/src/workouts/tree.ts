import type { TrackingType } from '../exercises/tracking';
import { SET_TYPES } from './schema';
import type { BlockKind, SetType, WorkoutDoc, WorkoutSetDoc } from './schema';
import { sectionsFromBlocks } from './sections';
import { TARGET_FIELDS } from './targets';

/**
 * PostgREST nested select for one workout with its blocks, exercises (and their names) and sets.
 * Embed order is not guaranteed, so workoutRowToDoc sorts every level by `position`.
 */
export const WORKOUT_TREE_SELECT =
  'id, name, notes, client_id, scheduled_on, ' +
  'workout_blocks(id, position, kind, section_id, section_name, ' +
  'workout_exercises(id, position, exercise_id, note, exercises(name, tracking_type), ' +
  'workout_substitutes(id, position, exercise_id, note, sets, exercises(name, tracking_type)), ' +
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

/** `sets` is the jsonb column: an array of WorkoutSetDoc (camelCase), as save_workout stored it. */
export type WorkoutTreeSubstituteRow = {
  id: string;
  position: number;
  exercise_id: string;
  note: string | null;
  sets: unknown;
  exercises: { name: string; tracking_type: TrackingType } | null;
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
    section_id: string | null;
    section_name: string | null;
    workout_exercises: Array<{
      id: string;
      position: number;
      exercise_id: string;
      note: string | null;
      exercises: { name: string; tracking_type: TrackingType } | null;
      workout_sets: WorkoutTreeSetRow[];
      /** Missing on rows selected before substitutes existed. */
      workout_substitutes?: WorkoutTreeSubstituteRow[];
    }>;
  }>;
};

const byPosition = <T extends { position: number }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.position - b.position);

const num = (v: Numeric): number | null => (v === null ? null : Number(v));

/**
 * The tracking type is read live from the exercise, but the sets were written for whatever type it had then.
 * Drop targets the current type doesn't use, so the doc stays valid and the coach can still open and save the
 * workout after changing an exercise's type.
 */
function fitSet(trackingType: TrackingType, s: WorkoutSetDoc): WorkoutSetDoc {
  const allowed = TARGET_FIELDS[trackingType];
  const keep = <T>(field: (typeof allowed)[number], v: T | null): T | null => (allowed.includes(field) ? v : null);
  return {
    ...s,
    targetRepsMin: keep('reps', s.targetRepsMin),
    targetRepsMax: keep('reps', s.targetRepsMax),
    targetWeightKg: keep('weight', s.targetWeightKg),
    targetDurationS: keep('duration', s.targetDurationS),
    targetDistanceM: keep('distance', s.targetDistanceM),
  };
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null);

/** A substitute's sets from its jsonb column; anything malformed becomes a plain set so the doc still loads. */
function jsonSets(value: unknown): WorkoutSetDoc[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw: unknown) => {
    const v = (raw ?? {}) as Record<string, unknown>;
    const setType = SET_TYPES.includes(v.setType as SetType) ? (v.setType as SetType) : 'normal';
    return {
      id: typeof v.id === 'string' ? v.id : '',
      setType,
      targetRepsMin: numOrNull(v.targetRepsMin),
      targetRepsMax: numOrNull(v.targetRepsMax),
      targetWeightKg: numOrNull(v.targetWeightKg),
      targetDurationS: numOrNull(v.targetDurationS),
      targetDistanceM: numOrNull(v.targetDistanceM),
      toFailure: v.toFailure === true,
      restSeconds: numOrNull(v.restSeconds) ?? 0,
      note: typeof v.note === 'string' ? v.note : null,
    };
  });
}

export function workoutRowToDoc(row: WorkoutTreeRow): WorkoutDoc {
  const blocks = byPosition(row.workout_blocks);
  return {
    id: row.id,
    name: row.name,
    notes: row.notes,
    sections: sectionsFromBlocks(blocks),
    blocks: blocks.map((b) => ({
      id: b.id,
      sectionId: b.section_id,
      kind: b.kind,
      exercises: byPosition(b.workout_exercises).map((e) => {
        const trackingType = e.exercises?.tracking_type ?? 'weight_reps';
        return {
          id: e.id,
          exerciseId: e.exercise_id,
          exerciseName: e.exercises?.name ?? '',
          trackingType,
          note: e.note,
          sets: byPosition(e.workout_sets).map((s) =>
            fitSet(trackingType, {
              id: s.id,
              setType: s.set_type,
              targetRepsMin: s.target_reps_min,
              targetRepsMax: s.target_reps_max,
              targetWeightKg: num(s.target_weight_kg),
              targetDurationS: s.target_duration_s,
              targetDistanceM: num(s.target_distance_m),
              toFailure: s.to_failure,
              restSeconds: s.rest_seconds,
              note: s.note,
            }),
          ),
          substitutes: byPosition(e.workout_substitutes ?? []).map((sub) => {
            const subType = sub.exercises?.tracking_type ?? 'weight_reps';
            return {
              id: sub.id,
              exerciseId: sub.exercise_id,
              exerciseName: sub.exercises?.name ?? '',
              trackingType: subType,
              note: sub.note,
              sets: jsonSets(sub.sets).map((s) => fitSet(subType, s)),
            };
          }),
        };
      }),
    })),
  };
}
