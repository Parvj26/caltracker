import { z } from 'zod';
import { TRACKING_TYPES } from '../exercises/tracking';
import type { TrackingType } from '../exercises/tracking';
import { MAX_CHOICE_OPTIONS, MIN_CHOICE_OPTIONS, sectionRuns } from './sections';
import { TARGET_FIELDS, TRACKING_TYPE_LABELS } from './targets';

export const SET_TYPES = ['normal', 'warmup', 'drop'] as const;
export type SetType = (typeof SET_TYPES)[number];

export const BLOCK_KINDS = ['straight', 'superset', 'choice'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

const TrackingTypeSchema = z.custom<TrackingType>((v) => TRACKING_TYPES.includes(v as TrackingType), {
  message: 'Unknown tracking type.',
});

export const WorkoutSetDoc = z.object({
  id: z.uuid(),
  setType: z.enum(SET_TYPES),
  targetRepsMin: z.number().int().min(1).max(1000).nullable(),
  targetRepsMax: z.number().int().min(1).max(1000).nullable(),
  targetWeightKg: z.number().min(0).max(1000).nullable(),
  targetDurationS: z.number().int().min(1).max(86400).nullable(),
  targetDistanceM: z.number().gt(0).max(1_000_000).nullable(),
  toFailure: z.boolean(),
  restSeconds: z.number().int().min(0).max(3600),
  note: z.string().max(500).nullable(),
});
export type WorkoutSetDoc = z.infer<typeof WorkoutSetDoc>;

/** `exerciseName` and `trackingType` are display and validation fields; save_workout does not write them. */
export const WorkoutExerciseDoc = z.object({
  id: z.uuid(),
  exerciseId: z.uuid(),
  exerciseName: z.string(),
  trackingType: TrackingTypeSchema,
  note: z.string().max(500).nullable(),
  sets: z.array(WorkoutSetDoc).min(1).max(20),
});
export type WorkoutExerciseDoc = z.infer<typeof WorkoutExerciseDoc>;

export const WorkoutSectionDoc = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Name the section.').max(40, 'Keep section names to 40 characters.'),
});
export type WorkoutSectionDoc = z.infer<typeof WorkoutSectionDoc>;

export const WorkoutBlockDoc = z.object({
  id: z.uuid(),
  sectionId: z.uuid().nullable().default(null),
  kind: z.enum(BLOCK_KINDS),
  exercises: z.array(WorkoutExerciseDoc).min(1).max(10),
});
export type WorkoutBlockDoc = z.infer<typeof WorkoutBlockDoc>;

type TargetField = 'reps' | 'weight' | 'duration' | 'distance';

const FIELD_LABELS: Record<TargetField, string> = {
  reps: 'Reps',
  weight: 'Weight',
  duration: 'Duration',
  distance: 'Distance',
};

const SET_FIELDS_BY_TARGET: ReadonlyArray<{
  field: TargetField;
  keys: ReadonlyArray<keyof WorkoutSetDoc>;
}> = [
  { field: 'reps', keys: ['targetRepsMin', 'targetRepsMax'] },
  { field: 'weight', keys: ['targetWeightKg'] },
  { field: 'duration', keys: ['targetDurationS'] },
  { field: 'distance', keys: ['targetDistanceM'] },
];

export const WorkoutDoc = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1, 'Enter a name.').max(100, 'Keep the name to 100 characters.'),
    notes: z.string().max(2000).nullable(),
    sections: z.array(WorkoutSectionDoc).max(10, 'Use at most 10 sections.').default([]),
    blocks: z.array(WorkoutBlockDoc).min(1, 'Add at least one exercise.').max(30),
  })
  .superRefine((doc, ctx) => {
    doc.blocks.forEach((block, bi) => {
      const blockPath = ['blocks', bi, 'exercises'];
      if (block.kind === 'straight' && block.exercises.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'A straight-sets block has exactly one exercise.',
          path: blockPath,
        });
      }
      if (block.kind === 'superset') {
        if (block.exercises.length < 2) {
          ctx.addIssue({
            code: 'custom',
            message: 'A superset needs at least two exercises.',
            path: blockPath,
          });
        }
      }
      if (
        block.kind === 'choice' &&
        (block.exercises.length < MIN_CHOICE_OPTIONS || block.exercises.length > MAX_CHOICE_OPTIONS)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'A pick-one group needs 2 to 5 exercises.',
          path: blockPath,
        });
      }
      block.exercises.forEach((ex, ei) => {
        const allowed = TARGET_FIELDS[ex.trackingType];
        ex.sets.forEach((s, si) => {
          const setPath = ['blocks', bi, 'exercises', ei, 'sets', si];
          if (si === 0 && s.setType === 'drop') {
            ctx.addIssue({
              code: 'custom',
              message: 'A drop set must follow a normal or warm-up set.',
              path: [...setPath, 'setType'],
            });
          }
          if (s.targetRepsMin !== null && s.targetRepsMax !== null && s.targetRepsMin > s.targetRepsMax) {
            ctx.addIssue({
              code: 'custom',
              message: "Minimum reps can't be more than maximum reps.",
              path: [...setPath, 'targetRepsMin'],
            });
          }
          for (const { field, keys } of SET_FIELDS_BY_TARGET) {
            if (allowed.includes(field)) continue;
            for (const key of keys) {
              if (s[key] !== null) {
                ctx.addIssue({
                  code: 'custom',
                  message: `${FIELD_LABELS[field]} doesn't apply to ${TRACKING_TYPE_LABELS[ex.trackingType]}.`,
                  path: [...setPath, key],
                });
              }
            }
          }
          if (s.toFailure && s.setType !== 'drop') {
            ctx.addIssue({
              code: 'custom',
              message: 'Only drop sets can be "to failure".',
              path: [...setPath, 'toFailure'],
            });
          }
        });
      });
    });

    const known = new Set<string>();
    doc.sections.forEach((section, si) => {
      if (known.has(section.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each section needs its own id.',
          path: ['sections', si],
        });
      }
      known.add(section.id);
    });
    doc.blocks.forEach((block, bi) => {
      if (block.sectionId !== null && !known.has(block.sectionId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown section.',
          path: ['blocks', bi, 'sectionId'],
        });
      }
    });
    const runs = sectionRuns(doc.blocks, doc.sections);
    const seen = new Set<string>();
    let lastOrder = -1;
    let sawSection = false;
    let ordered = true;
    for (const run of runs) {
      if (!run.section) {
        if (sawSection) ordered = false;
        continue;
      }
      sawSection = true;
      const order = doc.sections.findIndex((s) => s.id === run.section!.id);
      if (seen.has(run.section.id) || order < lastOrder) ordered = false;
      seen.add(run.section.id);
      lastOrder = order;
    }
    if (!ordered) {
      ctx.addIssue({
        code: 'custom',
        message: "Keep each section's exercises together.",
        path: ['blocks'],
      });
    }
    doc.sections.forEach((section, si) => {
      if (!doc.blocks.some((b) => b.sectionId === section.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Add an exercise to ${section.name} or remove the section.`,
          path: ['sections', si],
        });
      }
    });
  })
  .transform((doc) => ({
    ...doc,
    blocks: doc.blocks.map((b) => ({
      ...b,
      exercises: b.exercises.map((e) => ({
        ...e,
        sets: e.sets.map((s) => (s.setType === 'drop' ? { ...s, restSeconds: 0 } : s)),
      })),
    })),
  }));
export type WorkoutDoc = z.output<typeof WorkoutDoc>;
