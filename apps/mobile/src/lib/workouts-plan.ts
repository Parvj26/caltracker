// Pure helpers for the Workouts tab and its Preview: the week strip, the plan's totals and time estimate, muscle
// tags and the exercise lines. No network or React, so they are unit tested. Units, PRs and results are worded by
// @caltracker/shared.
import {
  addDays,
  countExercises,
  diffDays,
  formatLastResult,
  formatSetTarget,
  formatSetsSummary,
  muscleChipsOf,
  MUSCLE_CHIPS,
  startOfWeek,
  type IsoDate,
  type MuscleChip,
  type Units,
  type WorkoutDoc,
  type WorkoutExerciseDoc,
} from '@caltracker/shared';
import type { WorkoutStatus } from './active-log-logic';
import type { ExerciseDetail } from './exercise-detail';
import type { LastResults } from './log-api';
import { formatDayLabel, weekdayShort } from './workouts';

/** Week and day of the program a workout was copied for (both from 1). */
export type ProgramDay = { week: number; day: number };

/** One planned workout as the Workouts tab shows it. */
export type PlannedWorkout = {
  doc: WorkoutDoc;
  scheduledOn: IsoDate;
  programName: string | null;
  /** Only when the workout comes from a program. */
  programDay: ProgramDay | null;
};

/** The program week and day of `plannedOn`, counted from the assignment's start; null without a program. */
export function programDayOf(startDate: IsoDate | null, plannedOn: IsoDate | null): ProgramDay | null {
  if (!startDate || !plannedOn) return null;
  const d = diffDays(startDate, plannedOn);
  if (d < 0) return null;
  return { week: Math.floor(d / 7) + 1, day: (d % 7) + 1 };
}

export type PlanTotals = { exercises: number; sets: number; minutes: number };

/** Work time guessed for a set with no target time. */
const SET_WORK_S = 40;
/** Getting set up for each exercise. */
const EXERCISE_SETUP_S = 60;

/**
 * Exercises (a pick-one group counts once), sets (warm-ups and working sets; a drop continues the set before it)
 * and a rough time: each set's work (its target time, else 40 s) plus its rest, plus a minute per exercise, to the
 * nearest 5 minutes and never under 5. A pick-one group counts its first option, the best guess of what is done.
 */
export function planTotals(doc: Pick<WorkoutDoc, 'blocks'>): PlanTotals {
  let sets = 0;
  let seconds = 0;
  for (const b of doc.blocks) {
    const done = b.kind === 'choice' ? b.exercises.slice(0, 1) : b.exercises;
    for (const e of done) {
      seconds += EXERCISE_SETUP_S;
      for (const s of e.sets) {
        if (s.setType !== 'drop') sets += 1;
        seconds += (s.targetDurationS ?? SET_WORK_S) + s.restSeconds;
      }
    }
  }
  const exercises = countExercises(doc.blocks.map((b) => ({ kind: b.kind, exercises: b.exercises.length })));
  return { exercises, sets, minutes: Math.max(5, Math.round(seconds / 60 / 5) * 5) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "6 exercises · 18 sets · about 50 min" (the day card) or "5 exercises · about 45 min" (Coming up). */
export function planMeta(t: PlanTotals, withSets: boolean): string {
  return [plural(t.exercises, 'exercise'), withSets ? plural(t.sets, 'set') : null, `about ${t.minutes} min`]
    .filter(Boolean)
    .join(' · ');
}

/** The muscle chips of these exercises' primary muscles, once each, in the pickers' order. Unknown ids are skipped. */
export function muscleTags(exerciseIds: readonly string[], details: Readonly<Record<string, ExerciseDetail>>): MuscleChip[] {
  const found = new Set<MuscleChip>();
  for (const id of exerciseIds) for (const c of muscleChipsOf(details[id]?.primaryMuscles ?? [])) found.add(c);
  return MUSCLE_CHIPS.filter((c) => found.has(c));
}

export type StripDay = {
  date: IsoDate;
  dow: string;
  num: number;
  isToday: boolean;
  selected: boolean;
  hasWorkout: boolean;
  /** Every workout that day is done. */
  done: boolean;
  /** What a screen reader says for the day's button. */
  label: string;
};

const dayNum = (d: IsoDate) => Number(d.slice(8, 10));

/** The seven days from `weekStart` (a Monday) for the week strip. */
export function weekStrip(
  weekStart: IsoDate,
  today: IsoDate,
  selected: IsoDate | null,
  workouts: ReadonlyArray<{ id: string; scheduledOn: IsoDate }>,
  statuses: Readonly<Record<string, WorkoutStatus>>,
): StripDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const mine = workouts.filter((w) => w.scheduledOn === date);
    const hasWorkout = mine.length > 0;
    const done = hasWorkout && mine.every((w) => statuses[w.id]?.kind === 'done');
    const isToday = date === today;
    const label = [formatDayLabel(date), hasWorkout ? 'workout' : 'rest day', done ? 'done' : null, isToday ? 'today' : null]
      .filter(Boolean)
      .join(', ');
    return { date, dow: weekdayShort(date), num: dayNum(date), isToday, selected: date === selected, hasWorkout, done, label };
  });
}

/** The day picked when a week opens: today in this week, else its first workout day, else Monday. */
export function firstSelectedDay(
  weekStart: IsoDate,
  today: IsoDate,
  workouts: ReadonlyArray<{ scheduledOn: IsoDate }>,
): IsoDate {
  const end = addDays(weekStart, 6);
  if (today >= weekStart && today <= end) return today;
  const first = workouts
    .map((w) => w.scheduledOn)
    .filter((d) => d >= weekStart && d <= end)
    .sort()[0];
  return first ?? weekStart;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const monthOf = (d: IsoDate) => MONTHS[Number(d.slice(5, 7)) - 1] ?? '';

/** "This week · Nov 9–15", "Next week · Nov 30 – Dec 6", or just the range for other weeks. */
export function weekTitle(weekStart: IsoDate, today: IsoDate): string {
  const end = addDays(weekStart, 6);
  const range =
    monthOf(weekStart) === monthOf(end)
      ? `${monthOf(weekStart)} ${dayNum(weekStart)}–${dayNum(end)}`
      : `${monthOf(weekStart)} ${dayNum(weekStart)} – ${monthOf(end)} ${dayNum(end)}`;
  const weeks = Math.round(diffDays(startOfWeek(today), weekStart) / 7);
  const name = weeks === 0 ? 'This week' : weeks === -1 ? 'Last week' : weeks === 1 ? 'Next week' : null;
  return name ? `${name} · ${range}` : range;
}

/** The selected day's card heading: "Today · Mon 9", else "Wed 11 Nov". */
export function selectedHeading(date: IsoDate, today: IsoDate): string {
  return date === today ? `Today · ${weekdayShort(date)} ${dayNum(date)}` : formatDayLabel(date);
}

/** "Wed 11 Nov · Strength Block · Week 2 · Day 2", leaving out what isn't known. */
export function previewSubtitle(date: IsoDate, programName: string | null, programDay: ProgramDay | null): string {
  return [formatDayLabel(date), programName, programDay ? `Week ${programDay.week} · Day ${programDay.day}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** "3 × 6–8 reps · 185 lb" when the working sets share one target, else each set ("80 kg × 6–8, 84 kg × 6–8"). */
export function exercisePlanLine(e: Pick<WorkoutExerciseDoc, 'sets' | 'trackingType'>, units: Units): string {
  const working = e.sets.filter((s) => s.setType === 'normal');
  const first = working[0];
  if (first) {
    const text = formatSetTarget(first, e.trackingType, units);
    if (text !== '—' && working.every((s) => formatSetTarget(s, e.trackingType, units) === text)) {
      return `${working.length} × ${text}`;
    }
  }
  return formatSetsSummary(e.sets, e.trackingType, units).text;
}

/**
 * "Last time: 180 lb × 8" from the client's last finished log of this exercise, "New exercise" when there is none,
 * null when history couldn't be read (`last` null) or there is nothing worth showing.
 */
export function lastTimeLine(
  e: Pick<WorkoutExerciseDoc, 'exerciseId' | 'trackingType'>,
  last: LastResults | null,
  units: Units,
): string | null {
  if (last === null) return null;
  const entry = last[e.exerciseId];
  if (!entry) return 'New exercise';
  return formatLastResult(entry.sets, e.trackingType, units);
}

/** The coach's first name for "Note from Luis"; null when there is no name. */
export function coachFirstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}
