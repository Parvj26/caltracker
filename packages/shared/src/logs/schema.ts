import { z } from 'zod';
import { isRawObject, mapRawArray, withKnownTrackingType } from '../exercises/lenient';
import { TRACKING_TYPES } from '../exercises/tracking';
import type { TrackingType } from '../exercises/tracking';
import { MAX_CHOICE_OPTIONS, MIN_CHOICE_OPTIONS } from '../workouts/sections';
import { BLOCK_KINDS, SET_TYPES, WorkoutSectionDoc } from '../workouts/schema';

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

/**
 * One way of doing a planned exercise that has coach-added substitutes: the planned exercise itself
 * (substituteId null) or one substitute (its WorkoutSubstituteDoc id), with a snapshot of its planned sets.
 */
export const LogSubstituteOption = z.object({
  substituteId: z.uuid().nullable(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  trackingType: TrackingTypeSchema,
  /** The coach's note on that option ("use the blue band"); options saved before notes have none. */
  note: z.string().max(500).nullable().default(null),
  sets: z
    .array(z.object({ setType: z.enum(SET_TYPES), target: LogSetTarget }))
    .min(1)
    .max(30),
});
export type LogSubstituteOption = z.infer<typeof LogSubstituteOption>;

/**
 * The exercise's own fields (exerciseId, name, tracking type, sets) are always what the client is doing. When the
 * plan gave this exercise substitutes, `substituteOptions` lists every way to do it (the planned exercise first)
 * and `substituteId` says which one the fields are: null for the planned exercise. Choosing another option
 * (chooseSubstitute) swaps the fields, so everything that counts sets, volume or PRs only ever sees the exercise
 * actually done, and options not chosen have no logged sets at all.
 */
export const LogExerciseDoc = z.object({
  id: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  trackingType: TrackingTypeSchema,
  plannedWorkoutExerciseId: z.uuid().nullable(),
  swappedFromExerciseId: z.uuid().nullable(),
  note: z.string().max(500).nullable(),
  sets: z.array(LogSetDoc).min(1).max(30),
  /** Logs saved before substitutes have neither. */
  substituteId: z.uuid().nullable().default(null),
  substituteOptions: z.array(LogSubstituteOption).max(4).default([]),
});
export type LogExerciseDoc = z.infer<typeof LogExerciseDoc>;

export const LogBlockDoc = z.object({
  id: z.uuid(),
  sectionId: z.uuid().nullable().default(null),
  /** For a pick-one group: the log exercise the client chose; null until they choose. */
  pickedExerciseId: z.uuid().nullable().default(null),
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
    sections: z.array(WorkoutSectionDoc).max(10).default([]),
    blocks: z.array(LogBlockDoc).max(30),
  })
  .superRefine((doc, ctx) => {
    let completedSets = 0;
    const sectionIds = new Set(doc.sections.map((s) => s.id));
    doc.blocks.forEach((block, bi) => {
      if (block.sectionId !== null && !sectionIds.has(block.sectionId)) {
        ctx.addIssue({ code: 'custom', message: 'Unknown section.', path: ['blocks', bi, 'sectionId'] });
      }
      if (block.kind === 'choice' && (block.exercises.length < MIN_CHOICE_OPTIONS || block.exercises.length > MAX_CHOICE_OPTIONS)) {
        ctx.addIssue({ code: 'custom', message: 'A pick-one group needs 2 to 5 exercises.', path: ['blocks', bi, 'exercises'] });
      }
      if (block.pickedExerciseId !== null) {
        if (block.kind !== 'choice') {
          ctx.addIssue({ code: 'custom', message: 'Only a pick-one group can have a pick.', path: ['blocks', bi, 'pickedExerciseId'] });
        } else if (!block.exercises.some((e) => e.id === block.pickedExerciseId)) {
          ctx.addIssue({
            code: 'custom',
            message: "The pick must be one of the group's exercises.",
            path: ['blocks', bi, 'pickedExerciseId'],
          });
        }
      }
      if (block.kind === 'superset' && block.exercises.length < 2) {
        ctx.addIssue({
          code: 'custom',
          message: 'A superset needs at least two exercises.',
          path: ['blocks', bi, 'exercises'],
        });
      }
      block.exercises.forEach((ex, ei) => {
        const keys = ex.substituteOptions.map((o) => o.substituteId);
        if (new Set(keys).size !== keys.length) {
          ctx.addIssue({
            code: 'custom',
            message: 'Each substitute option appears once.',
            path: ['blocks', bi, 'exercises', ei, 'substituteOptions'],
          });
        }
        if (ex.substituteId !== null && !keys.includes(ex.substituteId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'The substitute must be one of the options.',
            path: ['blocks', bi, 'exercises', ei, 'substituteId'],
          });
        }
        ex.sets.forEach((s, si) => {
          if (s.completedAt !== null) completedSets += 1;
          if (s.completedAt !== null && block.kind === 'choice' && ex.id !== block.pickedExerciseId) {
            ctx.addIssue({
              code: 'custom',
              message: 'Only the picked option can have done sets.',
              path: ['blocks', bi, 'exercises', ei, 'sets', si, 'completedAt'],
            });
          }
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

/*
 * Lenient reads, for docs from the server or the phone's own storage: a tracking type this build doesn't know (a
 * newer server's) reads as FALLBACK_TRACKING_TYPE instead of failing the parse. The logged numbers are all kept: the
 * log schema doesn't tie targets or actuals to the tracking type. Writes keep using the strict schemas above.
 */

/** One substitute option as stored, with an unknown tracking type read as the fallback. */
export function parseLogSubstituteOptionLenient(raw: unknown) {
  return LogSubstituteOption.safeParse(isRawObject(raw) ? withKnownTrackingType(raw) : raw);
}

/** A log saved on the phone or sent by the server, with unknown tracking types read as the fallback. */
export function parseWorkoutLogDocLenient(raw: unknown) {
  if (!isRawObject(raw)) return WorkoutLogDoc.safeParse(raw);
  const fixed = mapRawArray(raw, 'blocks', (b) =>
    mapRawArray(b, 'exercises', (e) => mapRawArray(withKnownTrackingType(e), 'substituteOptions', (o) => withKnownTrackingType(o))),
  );
  return WorkoutLogDoc.safeParse(fixed);
}
