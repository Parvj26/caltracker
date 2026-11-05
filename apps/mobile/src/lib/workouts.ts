// Pure helpers for the client's calendar screens. No Supabase client here, so they run in unit tests;
// the fetchers live in ./workouts-api.ts.
import { addDays, isoWeekday, youtubeFormSearchUrl, type IsoDate } from '@caltracker/shared';

export type WorkoutSummary = {
  id: string;
  name: string;
  scheduledOn: IsoDate;
  exerciseCount: number;
  programName: string | null;
};

/** PostgREST select for a calendar card: name, date, program and exercise count (no sets). */
export const WORKOUT_SUMMARY_SELECT =
  'id, name, scheduled_on, program_assignments(program_name), workout_blocks(workout_exercises(count))';

export type WorkoutSummaryRow = {
  id: string;
  name: string;
  scheduled_on: string | null;
  program_assignments: { program_name: string } | null;
  workout_blocks: Array<{ workout_exercises: Array<{ count: number }> }>;
};

export function toWorkoutSummary(row: WorkoutSummaryRow): WorkoutSummary {
  return {
    id: row.id,
    name: row.name,
    scheduledOn: row.scheduled_on ?? '',
    exerciseCount: row.workout_blocks.reduce(
      (n, b) => n + b.workout_exercises.reduce((m, e) => m + Number(e.count), 0),
      0,
    ),
    programName: row.program_assignments?.program_name ?? null,
  };
}

/** The seven days from `from` (a Monday), each with its workouts in the order given. Empty days included. */
export function groupByDay(items: WorkoutSummary[], from: IsoDate): Array<{ date: IsoDate; items: WorkoutSummary[] }> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    return { date, items: items.filter((it) => it.scheduledOn === date) };
  });
}

/** A client with no workouts at all yet (none past or future) sees the first-time welcome instead of "Rest day". */
export function isFirstTimeClient(anyWorkouts: readonly WorkoutSummary[]): boolean {
  return anyWorkouts.length === 0;
}

/** Form video per exercise: the coach's pinned link, else the exercise's own, else a YouTube search. */
export function resolveVideoUrls(
  exercises: ReadonlyArray<{ exerciseId: string; exerciseName: string }>,
  ownVideos: ReadonlyArray<{ id: string; youtube_url: string | null }>,
  overrides: ReadonlyArray<{ exercise_id: string; youtube_url: string | null }>,
): Record<string, string> {
  const own = new Map(ownVideos.map((e) => [e.id, e.youtube_url]));
  const pinned = new Map(overrides.map((o) => [o.exercise_id, o.youtube_url]));
  const urls: Record<string, string> = {};
  for (const ex of exercises) {
    urls[ex.exerciseId] = pinned.get(ex.exerciseId) || own.get(ex.exerciseId) || youtubeFormSearchUrl(ex.exerciseName);
  }
  return urls;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Short weekday name of a calendar date, e.g. "Thu". */
export function weekdayShort(d: IsoDate): string {
  return WEEKDAYS[isoWeekday(d) - 1] ?? '';
}

/** "12 Nov": day and short month, read straight from the YYYY-MM-DD string. */
export function formatDayMonth(d: IsoDate): string {
  const [, m, day] = d.split('-').map(Number) as [number, number, number];
  return `${day} ${MONTHS[m - 1] ?? ''}`;
}

/** "Thu 12 Nov". */
export function formatDayLabel(d: IsoDate): string {
  return `${weekdayShort(d)} ${formatDayMonth(d)}`;
}

/** Up to two initials for an avatar: first letters of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}
