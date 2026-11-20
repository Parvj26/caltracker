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
  MONTHS_SHORT,
  muscleChipsOf,
  MUSCLE_CHIPS,
  formatClock,
  formatDuration,
  formatWeight,
  groupDropSets,
  planSetRange,
  setRangeText,
  startOfWeek,
  type SetRange,
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

export type PlanTotals = { exercises: number; sets: SetRange; minutes: number };

/** Work time guessed for a set with no target time. */
const SET_WORK_S = 40;
/** Getting set up for each exercise. */
const EXERCISE_SETUP_S = 60;

/**
 * Exercises (a pick-one group counts once), sets (the shared rule: every tickable row, warm-ups and drops too; a
 * pick-one group as a range) and a rough time: each set's work (its target time, else 40 s) plus its rest, plus a
 * minute per exercise, to the nearest 5 minutes and never under 5. The time counts a pick-one group's first option.
 */
export function planTotals(doc: Pick<WorkoutDoc, 'blocks'>): PlanTotals {
  let seconds = 0;
  for (const b of doc.blocks) {
    const done = b.kind === 'choice' ? b.exercises.slice(0, 1) : b.exercises;
    for (const e of done) {
      seconds += EXERCISE_SETUP_S;
      for (const s of e.sets) seconds += (s.targetDurationS ?? SET_WORK_S) + s.restSeconds;
    }
  }
  const exercises = countExercises(doc.blocks.map((b) => ({ kind: b.kind, exercises: b.exercises.length })));
  return { exercises, sets: planSetRange(doc.blocks), minutes: Math.max(5, Math.round(seconds / 60 / 5) * 5) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "6 exercises · 18–19 sets · about 50 min" (the day card) or "5 exercises · about 45 min" (Coming up). */
export function planMeta(t: PlanTotals, withSets: boolean): string {
  return [plural(t.exercises, 'exercise'), withSets ? setRangeText(t.sets) : null, `about ${t.minutes} min`]
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

const monthOf = (d: IsoDate) => MONTHS_SHORT[Number(d.slice(5, 7)) - 1] ?? '';

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

/** One piece of an exercise's plan line: a warm-up (shown with a W tag), the working sets, or a drop (↓ Drop tag). */
export type PlanPart = { kind: 'warmup' | 'work' | 'drop'; text: string };

/** "3 × 8 at 60 kg" (weight and reps), "3 × 30 s at 12 lb" (weight and time), "3 × 30 s"; null when the working sets don't share one target. */
function sharedTarget(sets: readonly WorkoutExerciseDoc['sets'][number][], trackingType: WorkoutExerciseDoc['trackingType'], units: Units): string | null {
  const first = sets[0];
  if (!first) return null;
  const text = formatSetTarget(first, trackingType, units);
  if (text === '—' || !sets.every((s) => formatSetTarget(s, trackingType, units) === text)) return null;
  const min = first.targetRepsMin ?? first.targetRepsMax;
  const max = first.targetRepsMax ?? first.targetRepsMin;
  if (trackingType === 'weight_reps' && !first.toFailure && first.targetWeightKg !== null && min !== null && max !== null) {
    return `${sets.length} × ${min === max ? min : `${min}–${max}`} at ${formatWeight(first.targetWeightKg, units)}`;
  }
  if (trackingType === 'weight_time' && !first.toFailure && first.targetWeightKg !== null && first.targetDurationS !== null) {
    return `${sets.length} × ${formatDuration(first.targetDurationS)} at ${formatWeight(first.targetWeightKg, units)}`;
  }
  return `${sets.length} × ${text}`;
}

/** A drop's target: "25 kg to failure", "25 kg × 8". */
function dropText(s: WorkoutExerciseDoc['sets'][number], trackingType: WorkoutExerciseDoc['trackingType'], units: Units): string {
  if (s.toFailure) return s.targetWeightKg !== null ? `${formatWeight(s.targetWeightKg, units)} to failure` : 'to failure';
  return formatSetsSummary([{ ...s, setType: 'normal' }], trackingType, units).text;
}

/**
 * The preview's line for an exercise, in pieces so warm-ups and drops can carry their tags: "[W] 20 kg × 10 · then 3 × 8
 * at 60 kg [↓ Drop] 25 kg to failure". Every set shows, so the line agrees with the set count and the logger.
 */
export function planLineParts(e: Pick<WorkoutExerciseDoc, 'sets' | 'trackingType'>, units: Units): PlanPart[] {
  const parts: PlanPart[] = [];
  for (const s of e.sets.filter((x) => x.setType === 'warmup')) {
    parts.push({ kind: 'warmup', text: formatSetsSummary([{ ...s, setType: 'normal' }], e.trackingType, units).text });
  }
  const working = e.sets.filter((s) => s.setType === 'normal');
  if (working.length > 0) {
    const shared = sharedTarget(working, e.trackingType, units);
    const text = shared ?? formatSetsSummary(working, e.trackingType, units).text;
    parts.push({ kind: 'work', text: parts.length > 0 ? `then ${text}` : text });
  }
  for (const s of e.sets.filter((x) => x.setType === 'drop')) parts.push({ kind: 'drop', text: dropText(s, e.trackingType, units) });
  return parts;
}

/** The same line as words, for screen readers: "warm-up 20 kg × 10, then 3 × 8 at 60 kg, drop 25 kg to failure". */
export function planLineSpoken(parts: readonly PlanPart[]): string {
  return parts.map((p) => (p.kind === 'warmup' ? `warm-up ${p.text}` : p.kind === 'drop' ? `drop ${p.text}` : p.text)).join(', ');
}

/**
 * "Last time: 180 lb × 8" from the client's last finished log of this exercise; null when there is none, when history
 * couldn't be read (`last` null) or there is nothing worth showing. A first time gets no line at all (less to read).
 */
export function lastTimeLine(
  e: Pick<WorkoutExerciseDoc, 'exerciseId' | 'trackingType'>,
  last: LastResults | null,
  units: Units,
): string | null {
  if (last === null) return null;
  const entry = last[e.exerciseId];
  if (!entry) return null;
  return formatLastResult(entry.sets, e.trackingType, units);
}

/** "SUPERSET · 3 ROUNDS" and "Back to back, then rest 1:00" for a planned superset (rest: the last exercise's rest). */
export function supersetPlanInfo(exercises: ReadonlyArray<Pick<WorkoutExerciseDoc, 'sets'>>): { heading: string; rest: string | null } {
  const rounds = Math.max(0, ...exercises.map((e) => groupDropSets(e.sets).length));
  const last = exercises[exercises.length - 1];
  const rest = Math.max(0, ...(last?.sets.filter((s) => s.setType !== 'drop').map((s) => s.restSeconds) ?? []));
  return {
    heading: `Superset · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`,
    rest: rest > 0 ? `Back to back, then rest ${formatClock(rest)}` : null,
  };
}

/** "Rest 1:30": the longest rest between an exercise's working sets, or null. */
export function exerciseRest(e: Pick<WorkoutExerciseDoc, 'sets'>): string | null {
  const secs = Math.max(0, ...e.sets.filter((s) => s.setType !== 'drop').map((s) => s.restSeconds));
  return secs > 0 ? `Rest ${formatClock(secs)}` : null;
}

/**
 * A preview row's screen-reader label: "A1, Bench Press, Each side, 3 × 8 at 60 kg, <help>, Last time: …". The row
 * shows only the chips, but the label keeps the superset tag and the help line that explains them.
 */
export function planRowLabel(row: {
  tag: string | null;
  name: string;
  badges: readonly string[];
  spokenLine: string;
  help: string | null;
  sub: string | null;
}): string {
  return [row.tag, row.name, ...row.badges, row.spokenLine, row.help, row.sub].filter(Boolean).join(', ');
}

/** The coach's first name for "Note from Luis"; null when there is no name. */
export function coachFirstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}
