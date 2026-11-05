import { z } from 'zod';
import { TRACKING_TYPES } from '../exercises/tracking';
import type { TrackingType } from '../exercises/tracking';
import { BLOCK_KINDS, SET_TYPES } from '../workouts/schema';

export const LOG_STATUSES = ['in_progress', 'completed', 'discarded'] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

const TrackingTypeSchema = z.custom<TrackingType>((v) => TRACKING_TYPES.includes(v as TrackingType), {
  message: 'Unknown tracking type.',
});

/** A snapshot of the planned set, so later edits to the plan never change the log. */
export const LogSetTarget = z.object({
  repsMin: z.number().int().min(1).max(1000).nullable(),
  repsMax: z.number().int().min(1).max(1000).nullable(),
  weightKg: z.number().min(0).max(1000).nullable(),
  durationS: z.number().int().min(1).max(86400).nullable(),
  distanceM: z.number().gt(0).max(1_000_000).nullable(),
  toFailure: z.boolean(),
  restSeconds: z.number().int().min(0).max(3600).nullable(),
});
export type LogSetTarget = z.infer<typeof LogSetTarget>;

export const LogSetDoc = z.object({
  id: z.uuid(),
  setType: z.enum(SET_TYPES),
  target: LogSetTarget,
  actualReps: z.number().int().min(0).max(1000).nullable(),
  actualWeightKg: z.number().min(0).max(1000).nullable(),
  actualDurationS: z.number().int().min(0).max(86400).nullable(),
  actualDistanceM: z.number().min(0).max(1_000_000).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type LogSetDoc = z.infer<typeof LogSetDoc>;

export const LogExerciseDoc = z.object({
  id: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  trackingType: TrackingTypeSchema,
  plannedWorkoutExerciseId: z.uuid().nullable(),
  swappedFromExerciseId: z.uuid().nullable(),
  note: z.string().max(500).nullable(),
  sets: z.array(LogSetDoc).min(1).max(30),
});
export type LogExerciseDoc = z.infer<typeof LogExerciseDoc>;

export const LogBlockDoc = z.object({
  id: z.uuid(),
  kind: z.enum(BLOCK_KINDS),
  exercises: z.array(LogExerciseDoc).min(1).max(10),
});
export type LogBlockDoc = z.infer<typeof LogBlockDoc>;

/**
 * Superset round equality is deliberately not enforced: a client may add a set
 * to one exercise mid-workout.
 */
export const WorkoutLogDoc = z
  .object({
    id: z.uuid(),
    workoutId: z.uuid().nullable(),
    name: z.string().trim().min(1, 'Enter a name.').max(100, 'Keep the name to 100 characters.'),
    status: z.enum(LOG_STATUSES),
    startedAt: z.iso.datetime({ offset: true }),
    finishedAt: z.iso.datetime({ offset: true }).nullable(),
    lastActivityAt: z.iso.datetime({ offset: true }),
    autoFinished: z.boolean(),
    revision: z.number().int().min(0),
    notes: z.string().max(2000).nullable(),
    blocks: z.array(LogBlockDoc).max(30),
  })
  .superRefine((doc, ctx) => {
    let completedSets = 0;
    doc.blocks.forEach((block, bi) => {
      if (block.kind === 'superset' && block.exercises.length < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'A superset needs at least two exercises.',
          path: ['blocks', bi, 'exercises'],
        });
      }
      block.exercises.forEach((ex, ei) => {
        ex.sets.forEach((s, si) => {
          if (s.completedAt !== null) completedSets += 1;
          if (si === 0 && s.setType === 'drop') {
            ctx.addIssue({
              code: 'custom',
              message: 'A drop set must follow a normal or warm-up set.',
              path: ['blocks', bi, 'exercises', ei, 'sets', si, 'setType'],
            });
          }
        });
      });
    });
    if (doc.status === 'completed' && completedSets === 0) {
      ctx.addIssue({ code: 'custom', message: 'Complete at least one set to finish.', path: ['status'] });
    }
  });
export type WorkoutLogDoc = z.output<typeof WorkoutLogDoc>;
