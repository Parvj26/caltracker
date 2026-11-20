import type { StrengthPoint } from '../awards/strength-series';
import { E1RM_MAX_REPS, loadStyleOf } from '../awards/load-style';
import type { LoadStyle } from '../awards/load-style';
import { bestE1rmLift, heavierLift } from '../awards/prs';
import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { formatPlainDayMonthInYear, formatRelativeDay } from '../dates/format';
import { formatWeight, fromKg, groupThousands } from '../units/units';
import type { Units } from '../units/units';

/**
 * Strength as the coach and the client both see it (product owner, 2026-11-19): the HEADLINE is the heaviest weight
 * lifted for an exercise, the estimated 1-rep max is the second number. Everything comes from sets already logged
 * (StrengthPoint: one per finished workout, from awards/strength-series). Pure, so both apps show the same numbers.
 */

export { E1RM_MAX_REPS, loadStyleOf } from '../awards/load-style';
export type { LoadStyle } from '../awards/load-style';

export type LiftSet = { weightKg: number; reps: number };

/** "82.5 kg", "+7.5 kg" (added), "20 kg assist" (assisted). */
export function loadText(weightKg: number, units: Units, style: LoadStyle): string {
  const w = formatWeight(weightKg, units);
  return style === 'added' ? `+${w}` : style === 'assisted' ? `${w} assist` : w;
}

/** "82.5 kg × 3", "+5 kg × 6". */
export function setText(set: LiftSet, units: Units, style: LoadStyle): string {
  return `${loadText(set.weightKg, units, style)} × ${set.reps}`;
}

const beats = heavierLift;

/** The session's estimated 1-rep max: the stored best (1–12 reps, plain weight; prs.ts estimate1rm), else from what an older saved point has. */
function sessionE1rm(p: StrengthPoint, style: LoadStyle): { kg: number; from: LiftSet } | null {
  if (style !== 'weight') return null;
  if (p.e1rm !== undefined) return p.e1rm ? { kg: p.e1rm.kg, from: p.e1rm.set } : null;
  const best = bestE1rmLift(p.heaviestSet ? [p.heaviestSet, p.bestSet] : [p.bestSet], style);
  return best ? { kg: best.kg, from: { weightKg: best.lift.weightKg, reps: best.lift.reps } } : null;
}

export type HeaviestSession = {
  /** The log it came from; null for a point saved on a phone before points kept it. */
  logId: string | null;
  date: IsoDate;
  /** The workout's name ("Lower Body"), or null when not known. */
  workoutName: string | null;
  heaviest: LiftSet;
  e1rm: { kg: number; from: LiftSet } | null;
  /**
   * This session holds the heaviest set of all (the earliest, on a tie), with at least 2 sessions logged. Only one
   * session is tagged, so steady progress doesn't tag every row.
   */
  heaviestYet: boolean;
};

/** One row per session, oldest first, from an exercise's whole series (so "Heaviest yet" looks at all of history). */
export function heaviestSessions(points: readonly StrengthPoint[], style: LoadStyle): HeaviestSession[] {
  const sessions = points.map<HeaviestSession>((p) => ({
    logId: p.logId ?? null,
    date: p.date,
    workoutName: p.logName ?? null,
    heaviest: p.heaviestSet ?? p.bestSet,
    e1rm: sessionE1rm(p, style),
    heaviestYet: false,
  }));
  const best = sessions.length > 1 ? bestOf(sessions, style) : null;
  return best ? sessions.map((s) => (s === best ? { ...s, heaviestYet: true } : s)) : sessions;
}

/** The sessions on or after `days` before today (null: all of them). */
export function sessionsSince<S extends { date: IsoDate }>(sessions: readonly S[], days: number | null, today: IsoDate): S[] {
  if (days === null) return [...sessions];
  const from = addDays(today, -days);
  return sessions.filter((s) => s.date >= from);
}

/** The change between two stored weights as shown: from the rounded display values, so it matches the numbers. */
function shownChange(fromKgValue: number, toKgValue: number, units: Units): number {
  return Math.round((fromKg(toKgValue, units) - fromKg(fromKgValue, units)) * 10) / 10;
}
const amount = (n: number, units: Units) => `${groupThousands(String(Math.abs(n)))} ${units}`;

export type HeaviestChange = {
  /** In display units; positive is progress (for assisted: that much less help). */
  amount: number;
  /** "+17.5 kg", "−5 kg", "No change". Assisted: "−10 kg assist". */
  short: string;
  /** "+17.5 kg since 2 Sep". */
  text: string;
  direction: 'up' | 'down' | 'same';
};

/**
 * The best session in the range against the range's first session. Null with fewer than 2 sessions. For assisted
 * lifts the change is in help, so going from 30 to 20 kg assist is progress ("−10 kg assist", direction up).
 */
export function heaviestChange(inRange: readonly HeaviestSession[], units: Units, style: LoadStyle, today: IsoDate): HeaviestChange | null {
  const first = inRange[0];
  const best = bestOf(inRange, style);
  if (!first || !best || inRange.length < 2) return null;
  const raw = shownChange(first.heaviest.weightKg, best.heaviest.weightKg, units);
  const progress = style === 'assisted' ? -raw : raw;
  const since = formatPlainDayMonthInYear(first.date, today);
  if (raw === 0) return { amount: 0, short: 'No change', text: `No change since ${since}`, direction: 'same' };
  const sign = raw > 0 ? '+' : '−';
  const short = `${sign}${amount(raw, units)}${style === 'assisted' ? ' assist' : ''}`;
  return { amount: progress, short, text: `${short} since ${since}`, direction: progress > 0 ? 'up' : 'down' };
}

/** The session with the heaviest set (least help when assisted); the earliest wins a tie. */
export function bestOf(sessions: readonly HeaviestSession[], style: LoadStyle): HeaviestSession | null {
  let best: HeaviestSession | null = null;
  for (const s of sessions) if (!best || beats(s.heaviest, best.heaviest, style)) best = s;
  return best;
}

/** The session with the best estimated 1-rep max, or null when none has one. */
export function bestE1rmOf(sessions: readonly HeaviestSession[]): HeaviestSession | null {
  let best: HeaviestSession | null = null;
  for (const s of sessions) if (s.e1rm && (!best?.e1rm || s.e1rm.kg > best.e1rm.kg)) best = s;
  return best;
}

export type StrengthStats = {
  /** "82.5 kg" (the big number), or null with no session in the range. */
  heaviest: string | null;
  /** "82.5 kg × 3 on 17 Nov". */
  heaviestDetail: string | null;
  change: HeaviestChange | null;
  /** "93 kg", or null when there is no estimate. */
  e1rm: string | null;
  /** "From 80 kg × 5", or why there is no estimate. */
  e1rmDetail: string;
};

/** The two stat tiles: heaviest weight (+ change since the range's first session) and estimated 1-rep max (+ which set). */
export function strengthStats(inRange: readonly HeaviestSession[], units: Units, style: LoadStyle, today: IsoDate): StrengthStats {
  const best = bestOf(inRange, style);
  const top = bestE1rmOf(inRange);
  const e1rmDetail =
    top?.e1rm ? `From ${setText(top.e1rm.from, units, style)}`
    : style !== 'weight' ? 'Not estimated for bodyweight lifts'
    : inRange.length === 0 ? 'No sessions in this range'
    : `Needs a set of ${E1RM_MAX_REPS} reps or fewer`;
  return {
    heaviest: best ? loadText(best.heaviest.weightKg, units, style) : null,
    heaviestDetail: best ? `${setText(best.heaviest, units, style)} on ${formatPlainDayMonthInYear(best.date, today)}` : null,
    change: heaviestChange(inRange, units, style, today),
    e1rm: top?.e1rm ? formatWeight(top.e1rm.kg, units) : null,
    e1rmDetail,
  };
}

/** The verb for "You squat 38 lb more…", from the exercise name; null when none fits. */
function verbOf(name: string): string | null {
  const n = name.toLowerCase();
  if (/deadlift/.test(n)) return 'deadlift';
  if (/squat/.test(n)) return 'squat';
  if (/bench/.test(n)) return 'bench';
  if (/press/.test(n)) return 'press';
  if (/\brows?\b/.test(n)) return 'row';
  if (/curl/.test(n)) return 'curl';
  return null;
}

/**
 * The one plain sentence under the numbers: "You squat 38 lb more than when you started. Nice work." `fromStart`
 * says the range reaches back to the first session ever ("than when you started"); otherwise it names the date.
 */
export function heaviestSentence(name: string, inRange: readonly HeaviestSession[], units: Units, style: LoadStyle, today: IsoDate, fromStart: boolean): string {
  const first = inRange[0];
  if (!first) return 'No workouts with this exercise in this range.';
  const change = heaviestChange(inRange, units, style, today);
  if (!change) return 'One workout in this range. Log it again to see a trend.';
  const since = formatPlainDayMonthInYear(first.date, today);
  const than = fromStart ? 'than when you started' : `than on ${since}`;
  const amt = amount(change.amount, units);
  // "Holding steady" only when the latest session is the best one (product owner, 2026-11-19); a dip is said plainly.
  const below = belowBest(inRange, units, style);
  const dip = below === null ? null : style === 'assisted' ? `${amount(below, units)} more help than your best last time; it happens.` : `Down ${amount(below, units)} from your best last time; it happens.`;
  if (change.direction === 'same') return dip ? dip.replace(' last time', '') : `Your heaviest is holding steady since ${since}.`;
  // The best in the range is never behind the range's first session, so the change here is always progress.
  const cheer = dip ? ` ${dip}` : ' Nice work.';
  if (style === 'assisted') return `You need ${amt} less help ${than}.${cheer}`;
  if (style === 'added') return `You add ${amt} more ${than}.${cheer}`;
  const verb = verbOf(name);
  return verb ? `You ${verb} ${amt} more ${than}.${cheer}` : `You lift ${amt} more on ${name} ${than}.${cheer}`;
}

/** How far the latest session is behind the best in the range (display units, always positive), or null when it is the best. */
export function belowBest(inRange: readonly HeaviestSession[], units: Units, style: LoadStyle): number | null {
  const last = inRange.at(-1);
  const best = bestOf(inRange, style);
  if (!last || !best || last === best) return null;
  const raw = shownChange(last.heaviest.weightKg, best.heaviest.weightKg, units);
  const gap = style === 'assisted' ? -raw : raw;
  return gap > 0 ? gap : null;
}

export type SessionRowView = {
  key: string;
  logId: string | null;
  /** "82.5 kg × 3". */
  set: string;
  /** "Mon 17 Nov · Lower Body". */
  meta: string;
  heaviestYet: boolean;
  /** For screen readers: "Mon 17 Nov, Lower Body: heaviest set 82.5 kg × 3, estimated 1-rep max 93 kg. Heaviest yet." */
  label: string;
};

/** The sessions list, newest first: each session's heaviest set, when, the workout, and a "Heaviest yet" tag. */
export function heaviestSessionRows(sessions: readonly HeaviestSession[], units: Units, style: LoadStyle, today: IsoDate): SessionRowView[] {
  return [...sessions].reverse().map((s, i) => {
    const when = formatRelativeDay(s.date, today);
    const set = setText(s.heaviest, units, style);
    const meta = s.workoutName ? `${when} · ${s.workoutName}` : when;
    const e1 = s.e1rm ? `, estimated 1-rep max ${formatWeight(s.e1rm.kg, units)}` : '';
    return {
      key: s.logId ?? `${s.date}-${sessions.length - 1 - i}`,
      logId: s.logId,
      set,
      meta,
      heaviestYet: s.heaviestYet,
      label: `${s.workoutName ? `${when}, ${s.workoutName}` : when}: heaviest set ${set}${e1}.${s.heaviestYet ? ' Heaviest yet.' : ''}`,
    };
  });
}

/** One chart point: the session's heaviest weight (solid line) and its estimated 1-rep max (dashed, may be missing). */
export type HeaviestChartPoint = { date: IsoDate; heaviestKg: number; e1rmKg: number | null; label: string };

/** The chart's points and a sentence that says what it shows (its text alternative). */
export function heaviestChart(name: string, inRange: readonly HeaviestSession[], units: Units, style: LoadStyle, today: IsoDate): { points: HeaviestChartPoint[]; summary: string } {
  const points = inRange.map((s) => ({
    date: s.date,
    heaviestKg: s.heaviest.weightKg,
    e1rmKg: s.e1rm?.kg ?? null,
    label: `${formatPlainDayMonthInYear(s.date, today)}: heaviest ${setText(s.heaviest, units, style)}${s.e1rm ? `, estimated 1-rep max ${formatWeight(s.e1rm.kg, units)}` : ''}`,
  }));
  const first = inRange[0];
  const last = inRange.at(-1);
  if (!first || !last) return { points, summary: `${name}: no workouts in this range.` };
  const count = `${inRange.length} ${inRange.length === 1 ? 'session' : 'sessions'}`;
  if (inRange.length === 1) return { points, summary: `${name}, heaviest weight per session: ${count}, ${loadText(first.heaviest.weightKg, units, style)} on ${formatPlainDayMonthInYear(first.date, today)}.` };
  const best = bestOf(inRange, style)!;
  const topE1rm = bestE1rmOf(inRange);
  const dashed = topE1rm?.e1rm ? ` The dashed line is the estimated 1-rep max, best ${formatWeight(topE1rm.e1rm.kg, units)} on ${formatPlainDayMonthInYear(topE1rm.date, today)}.` : '';
  return {
    points,
    summary: `${name}, heaviest weight per session: ${count}, from ${loadText(first.heaviest.weightKg, units, style)} on ${formatPlainDayMonthInYear(first.date, today)} to ${loadText(last.heaviest.weightKg, units, style)} on ${formatPlainDayMonthInYear(last.date, today)}. Heaviest ${loadText(best.heaviest.weightKg, units, style)} on ${formatPlainDayMonthInYear(best.date, today)}.${dashed}`,
  };
}

export type StrengthExerciseRow = {
  exerciseId: string;
  name: string;
  style: LoadStyle;
  sessionCount: number;
  lastDate: IsoDate;
  /** "80 kg × 5 · Mon 17 Nov". */
  lastSession: string;
  /** "82.5 kg". */
  heaviest: string;
  /** "+17.5 kg", "No change", or null with one session. */
  sinceStart: string | null;
  direction: HeaviestChange['direction'] | null;
  /** The heaviest weight per session, oldest first, for the sparkline (stored kg; assisted reads lower = better). */
  trend: number[];
};

/**
 * The Strength section's rows (coach Metrics): every exercise with a session in the range, most recently trained
 * first, with its last session, trend, heaviest weight and change since the range's first session.
 */
export function strengthExerciseRows(
  exercises: ReadonlyArray<{ exerciseId: string; name: string; points: readonly StrengthPoint[] }>,
  units: Units,
  today: IsoDate,
  days: number | null = null,
): StrengthExerciseRow[] {
  return exercises
    .flatMap((e) => {
      const style = loadStyleOf(e.name);
      const inRange = sessionsSince(heaviestSessions(e.points, style), days, today);
      const last = inRange.at(-1);
      const best = bestOf(inRange, style);
      if (!last || !best) return [];
      const change = heaviestChange(inRange, units, style, today);
      return [
        {
          exerciseId: e.exerciseId,
          name: e.name,
          style,
          sessionCount: inRange.length,
          lastDate: last.date,
          lastSession: `${setText(last.heaviest, units, style)} · ${formatRelativeDay(last.date, today)}`,
          heaviest: loadText(best.heaviest.weightKg, units, style),
          sinceStart: change?.short ?? null,
          direction: change?.direction ?? null,
          trend: inRange.map((s) => s.heaviest.weightKg),
        },
      ];
    })
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.name.localeCompare(b.name)));
}

/**
 * The Strength row on the client's Progress tab (approved Progress board): the most-trained exercise and its heaviest
 * weight ("Barbell Squat 62.5 kg"), then "Heaviest weight · +17.5 kg since 2 Sep" over the last 3 months.
 */
export function heaviestTile(exercise: { name: string; points: readonly StrengthPoint[] } | undefined, units: Units, today: IsoDate): { value: string; sub: string } {
  if (!exercise || exercise.points.length === 0) return { value: 'No lifts yet', sub: 'Log a workout to start' };
  const style = loadStyleOf(exercise.name);
  const all = heaviestSessions(exercise.points, style);
  const recent = sessionsSince(all, 91, today);
  const change = heaviestChange(recent, units, style, today);
  const best = bestOf(recent.length > 0 ? recent : all, style)!;
  const value = `${exercise.name} ${loadText(best.heaviest.weightKg, units, style)}`;
  if (!change) return { value, sub: 'Heaviest weight' };
  return { value, sub: `Heaviest weight · ${change.direction === 'same' ? change.text.replace(/^No change/, 'no change') : change.text}` };
}
