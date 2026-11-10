// free-exercise-db equipment names, used by the custom exercise form.
export const EQUIPMENT = [
  'bands', 'barbell', 'body only', 'cable', 'dumbbell', 'e-z curl bar', 'exercise ball',
  'foam roll', 'kettlebells', 'machine', 'medicine ball', 'other',
] as const;

export const TRACKING_LABELS = {
  weight_reps: 'Weight and reps',
  reps: 'Reps only',
  time: 'Time',
  distance: 'Distance',
  weight_time: 'Weight and time',
  // Only a workout exercise's own measurements use these; a library exercise is always one of the five above.
  weight: 'Weight only',
  reps_time: 'Reps and time',
  weight_reps_time: 'Weight, reps and time',
} as const;

/** Escapes LIKE wildcards so user input matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
