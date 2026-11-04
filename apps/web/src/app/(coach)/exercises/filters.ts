// free-exercise-db vocabularies, used for the filter dropdowns.
export const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes',
  'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps',
] as const;

export const EQUIPMENT = [
  'bands', 'barbell', 'body only', 'cable', 'dumbbell', 'e-z curl bar', 'exercise ball',
  'foam roll', 'kettlebells', 'machine', 'medicine ball', 'other',
] as const;

export const TRACKING_LABELS = {
  weight_reps: 'Weight and reps',
  reps: 'Reps only',
  time: 'Time',
  distance: 'Distance',
} as const;

/** Escapes LIKE wildcards so user input matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
