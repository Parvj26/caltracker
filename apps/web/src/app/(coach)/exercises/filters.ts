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
} as const;

/** Escapes LIKE wildcards so user input matches literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
