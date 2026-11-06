import type { TrackingType } from '../exercises/tracking';
import type { BlockKind, SetType } from '../workouts/schema';
import { sectionsFromBlocks } from '../workouts/sections';
import type { LogStatus, LogSubstituteOption, WorkoutLogDoc } from './schema';

/**
 * PostgREST nested select for one workout log with its blocks, exercises (and their names) and sets.
 * log_exercises links to exercises twice (exercise_id and swapped_from_exercise_id), so the embed names
 * the foreign key to follow. Embed order is not guaranteed, so logRowToDoc sorts every level by `position`.
 */
export const LOG_TREE_SELECT =
  'id, workout_id, name, status, started_at, finished_at, last_activity_at, auto_finished, revision, notes, ' +
  'log_blocks(id, position, kind, section_id, section_name, picked_exercise_id, ' +
  'log_exercises(id, position, exercise_id, planned_workout_exercise_id, swapped_from_exercise_id, note, ' +
  'exercises!log_exercises_exercise_id_fkey(name, tracking_type), ' +
  'log_sets(id, position, set_type, target_reps_min, target_reps_max, target_weight_kg, target_duration_s, ' +
  'target_distance_m, to_failure, rest_seconds, actual_reps, actual_weight_kg, actual_duration_s, ' +
  'actual_distance_m, completed_at)))';

/** Postgres `numeric` can arrive as a string (for example '61.235'), depending on the client. */
type Numeric = number | string | null;

export type LogTreeSetRow = {
  id: string;
  position: number;
  set_type: SetType;
  target_reps_min: number | null;
  target_reps_max: number | null;
  target_weight_kg: Numeric;
  target_duration_s: number | null;
  target_distance_m: Numeric;
  to_failure: boolean;
  rest_seconds: number | null;
  actual_reps: number | null;
  actual_weight_kg: Numeric;
  actual_duration_s: number | null;
  actual_distance_m: Numeric;
  completed_at: string | null;
};

export type LogTreeRow = {
  id: string;
  workout_id: string | null;
  name: string;
  status: LogStatus;
  started_at: string;
  finished_at: string | null;
  last_activity_at: string;
  auto_finished: boolean;
  revision: number;
  notes: string | null;
  log_blocks: Array<{
    id: string;
    position: number;
    kind: BlockKind;
    section_id: string | null;
    section_name: string | null;
    picked_exercise_id: string | null;
    log_exercises: Array<{
      id: string;
      position: number;
      exercise_id: string;
      planned_workout_exercise_id: string | null;
      swapped_from_exercise_id: string | null;
      note: string | null;
      /** Missing on rows selected before substitutes existed. */
      substitute_id?: string | null;
      /** The jsonb column: LogSubstituteOption[] in the doc's camelCase, as save_workout_log stored it. */
      substitute_options?: unknown;
      exercises: { name: string; tracking_type: TrackingType } | null;
      log_sets: LogTreeSetRow[];
    }>;
  }>;
};

const byPosition = <T extends { position: number }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => a.position - b.position);

const num = (v: Numeric): number | null => (v === null ? null : Number(v));

/**
 * Unlike workoutRowToDoc, nothing is dropped when the exercise's tracking type has changed since: a log is
 * a record of what was done, and the log schema does not tie targets or actuals to the tracking type.
 */
export function logRowToDoc(row: LogTreeRow): WorkoutLogDoc {
  const blocks = byPosition(row.log_blocks);
  return {
    id: row.id,
    workoutId: row.workout_id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastActivityAt: row.last_activity_at,
    autoFinished: row.auto_finished,
    revision: row.revision,
    notes: row.notes,
    sections: sectionsFromBlocks(blocks),
    blocks: blocks.map((b) => ({
      id: b.id,
      sectionId: b.section_id,
      pickedExerciseId: b.picked_exercise_id,
      kind: b.kind,
      exercises: byPosition(b.log_exercises).map((e) => ({
        id: e.id,
        exerciseId: e.exercise_id,
        exerciseName: e.exercises?.name ?? '',
        trackingType: e.exercises?.tracking_type ?? 'weight_reps',
        plannedWorkoutExerciseId: e.planned_workout_exercise_id,
        swappedFromExerciseId: e.swapped_from_exercise_id,
        note: e.note,
        substituteId: e.substitute_id ?? null,
        // Stored by save_workout_log from a parsed doc; WorkoutLogDoc.parse checks it again.
        substituteOptions: Array.isArray(e.substitute_options) ? (e.substitute_options as LogSubstituteOption[]) : [],
        sets: byPosition(e.log_sets).map((s) => ({
          id: s.id,
          setType: s.set_type,
          target: {
            repsMin: s.target_reps_min,
            repsMax: s.target_reps_max,
            weightKg: num(s.target_weight_kg),
            durationS: s.target_duration_s,
            distanceM: num(s.target_distance_m),
            toFailure: s.to_failure,
            restSeconds: s.rest_seconds,
          },
          actualReps: s.actual_reps,
          actualWeightKg: num(s.actual_weight_kg),
          actualDurationS: s.actual_duration_s,
          actualDistanceM: num(s.actual_distance_m),
          completedAt: s.completed_at,
        })),
      })),
    })),
  };
}
