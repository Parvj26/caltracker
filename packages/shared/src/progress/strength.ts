import type { PersonalBestRow } from '../awards/bests';
import { liftsByExercise } from '../awards/prs';
import { formatShortDate } from '../body/series';
import type { StrengthPoint } from '../awards/strength-series';
import { localDay } from '../awards/streak';
import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { normalizeSearchText } from '../exercises/search';
import type { WorkoutLogDoc } from '../logs/schema';
import { formatWeight, fromKg, groupThousands } from '../units/units';
import type { Units } from '../units/units';

/**
 * The client's Strength and Personal bests screens on Progress. The maths (estimated 1RM, counted sets, records) is in
 * awards/; this arranges it: which exercises to offer, the time ranges, and the words.
 */

/** One exercise as the Strength screen keeps it: its estimated-1RM series and its primary muscle. */
export type StrengthExerciseLite = { exerciseId: string; name: string; muscle?: string | null; points: readonly StrengthPoint[] };

export const MOST_TRAINED_DAYS = 91;

/**
 * The exercises trained in the most workouts over the last 3 months (product owner, 2026-11-09: the quick chips),
 * most first; a tie goes to the one trained most recently, then by name.
 */
export function mostTrained<T extends StrengthExerciseLite>(exercises: readonly T[], today: IsoDate, limit = 3): T[] {
  const from = addDays(today, -MOST_TRAINED_DAYS);
  return exercises
    .map((e) => {
      const recent = e.points.filter((p) => p.date >= from && p.date <= today);
      return { e, count: recent.length, last: recent.at(-1)?.date ?? '' };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}

export const STRENGTH_RANGES = ['1m', '3m', 'all'] as const;
export type StrengthRange = (typeof STRENGTH_RANGES)[number];
export const STRENGTH_RANGE_LABELS: Record<StrengthRange, string> = { '1m': '1 mo', '3m': '3 mo', all: 'All' };
const RANGE_DAYS: Record<StrengthRange, number | null> = { '1m': 30, '3m': MOST_TRAINED_DAYS, all: null };

export function pointsInRange<P extends { date: IsoDate }>(points: readonly P[], range: StrengthRange, today: IsoDate): P[] {
  const days = RANGE_DAYS[range];
  if (days === null) return [...points];
  const from = addDays(today, -days);
  return points.filter((p) => p.date >= from);
}

/** The change between two stored weights as shown: from the rounded display values, so it matches the numbers. */
function shownChange(fromKgValue: number, toKgValue: number, units: Units): number {
  return Math.round((fromKg(toKgValue, units) - fromKg(fromKgValue, units)) * 10) / 10;
}
const amount = (n: number, units: Units) => `${groupThousands(String(Math.abs(n)))} ${units}`;

/** The big number, its change and one plain-English line for the chosen range's points. */
export function strengthHeadline(
  points: readonly StrengthPoint[],
  units: Units,
  today: IsoDate,
): { value: string | null; change: string | null; line: string } {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return { value: null, change: null, line: 'No workouts with this exercise in this range.' };
  const value = formatWeight(last.e1rmKg, units);
  if (points.length === 1) return { value, change: null, line: 'One workout in this range. Log it again to see a trend.' };
  const diff = shownChange(first.e1rmKg, last.e1rmKg, units);
  const since = formatShortDate(first.date, today);
  if (diff === 0) return { value, change: `No change since ${since}`, line: `Your estimated max is holding steady since ${since}.` };
  if (diff > 0) {
    return { value, change: `+${amount(diff, units)} since ${since}`, line: `Your estimated max is up ${amount(diff, units)} since ${since}. Nice progress.` };
  }
  return { value, change: `−${amount(diff, units)} since ${since}`, line: `Your estimated max is ${amount(diff, units)} under ${since}. Ups and downs are normal.` };
}

/** The Strength tile on Progress: the most-trained exercise and its 3-month change in estimated max. */
export function strengthTile(exercises: readonly StrengthExerciseLite[], units: Units, today: IsoDate): { value: string; sub: string } {
  const top =
    mostTrained(exercises, today, 1)[0] ??
    [...exercises].sort((a, b) => ((a.points.at(-1)?.date ?? '') < (b.points.at(-1)?.date ?? '') ? 1 : -1))[0];
  const last = top?.points.at(-1);
  if (!top || !last) return { value: 'No lifts yet', sub: 'log a workout to start' };
  const recent = pointsInRange(top.points, '3m', today);
  const first = recent[0];
  if (recent.length < 2 || !first) return { value: `${top.name} ${formatWeight(last.e1rmKg, units)}`, sub: 'est. max' };
  const diff = shownChange(first.e1rmKg, last.e1rmKg, units);
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  return { value: `${top.name} ${sign}${amount(diff, units)}`, sub: `est. max since ${formatShortDate(first.date, today)}` };
}

export type PickerItem = { exerciseId: string; name: string; bestKg: number };
export type PickerSection = { title: string; items: PickerItem[] };

const titleCase = (s: string) => s.replace(/^\p{L}/u, (c) => c.toUpperCase());

/**
 * The exercise list: with no search, the most recently trained first, then every exercise grouped by its primary
 * muscle ("Other" when unknown); with a search, the matches by name. Each shows its best estimated max.
 */
export function strengthPickerSections(exercises: readonly StrengthExerciseLite[], query: string, recentCount = 5): PickerSection[] {
  const item = (e: StrengthExerciseLite): PickerItem => ({
    exerciseId: e.exerciseId,
    name: e.name,
    bestKg: e.points.reduce((m, p) => Math.max(m, p.e1rmKg), 0),
  });
  const byName = (a: StrengthExerciseLite, b: StrengthExerciseLite) => a.name.localeCompare(b.name);
  const words = normalizeSearchText(query).split(' ').filter(Boolean);
  if (words.length > 0) {
    const hits = exercises.filter((e) => {
      const name = normalizeSearchText(e.name);
      return words.every((w) => name.includes(w));
    });
    return hits.length === 0 ? [] : [{ title: 'Results', items: [...hits].sort(byName).map(item) }];
  }
  const lastDate = (e: StrengthExerciseLite) => e.points.at(-1)?.date ?? '';
  const recent = [...exercises]
    .filter((e) => e.points.length > 0)
    .sort((a, b) => (lastDate(a) < lastDate(b) ? 1 : lastDate(a) > lastDate(b) ? -1 : byName(a, b)))
    .slice(0, recentCount);
  const groups = new Map<string, StrengthExerciseLite[]>();
  for (const e of exercises) {
    const title = e.muscle ? titleCase(e.muscle) : 'Other';
    groups.set(title, [...(groups.get(title) ?? []), e]);
  }
  const titles = [...groups.keys()].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  return [
    ...(recent.length > 0 ? [{ title: 'Recent', items: recent.map(item) }] : []),
    ...titles.map((title) => ({ title, items: [...groups.get(title)!].sort(byName).map(item) })),
  ];
}

export type StrengthSession = { logId: string; date: IsoDate; sets: { weightKg: number; reps: number }[] };

/** The counted sets (no warm-ups) of the exercise in each finished workout, newest first, at most `limit`. */
export function exerciseSessions(logs: readonly WorkoutLogDoc[], exerciseId: string, timeZone: string, limit: number): StrengthSession[] {
  return logs
    .filter((l) => l.status === 'completed' && l.finishedAt)
    .flatMap((l) => {
      const lifts = liftsByExercise(l).get(exerciseId);
      return lifts && lifts.length > 0
        ? [{ at: l.finishedAt!, s: { logId: l.id, date: localDay(l.finishedAt!, timeZone), sets: lifts.map((x) => ({ weightKg: x.weightKg, reps: x.reps })) } }]
        : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((x) => x.s);
}

/**
 * The Recent sessions rows: "60 × 8, 60 × 7" (the unit is in the label and the heading) and a PR tag when that workout
 * set a personal best for the exercise. `prKeys` holds "logId|exerciseId" of every PR (from the stored awards).
 */
export function sessionRows(
  sessions: readonly StrengthSession[],
  prKeys: ReadonlySet<string>,
  exerciseId: string,
  units: Units,
  today: IsoDate,
): { logId: string; when: string; sets: string; pr: boolean; label: string }[] {
  return sessions.map((s) => {
    const pr = prKeys.has(`${s.logId}|${exerciseId}`);
    const when = formatShortDate(s.date, today);
    return {
      logId: s.logId,
      when,
      sets: s.sets.map((x) => `${groupThousands(String(fromKg(x.weightKg, units)))} × ${x.reps}`).join(', '),
      pr,
      label: `${when}: ${s.sets.map((x) => `${formatWeight(x.weightKg, units)} × ${x.reps}`).join(', ')}.${pr ? ' Personal best.' : ''}`,
    };
  });
}

/** The Personal bests list: each exercise's best in words, newest first. */
export function bestsList(
  rows: readonly PersonalBestRow[],
  units: Units,
  today: IsoDate,
  timeZone: string,
): { exerciseId: string; name: string; detail: string; value: string; when: string }[] {
  return [...rows]
    .sort((a, b) => b.achievedAt.localeCompare(a.achievedAt) || a.name.localeCompare(b.name))
    .map((r) => {
      const detail =
        r.weightKg !== null ? (r.e1rmKg !== null ? `Heaviest · est. max ${formatWeight(r.e1rmKg, units)}` : 'Heaviest') : 'Est. max';
      const value =
        r.weightKg !== null
          ? r.reps !== null
            ? `${formatWeight(r.weightKg, units)} × ${r.reps}`
            : formatWeight(r.weightKg, units)
          : formatWeight(r.e1rmKg ?? 0, units);
      return { exerciseId: r.exerciseId, name: r.name, detail, value, when: formatShortDate(localDay(r.achievedAt, timeZone), today) };
    });
}

/** The Personal bests tile: how many exercises have a best, and how many lifts improved this week. */
export function bestsTile(count: number, newThisWeek: number): { value: string; sub: string } {
  if (count === 0) return { value: 'None yet', sub: 'finish a workout to set one' };
  return { value: String(count), sub: newThisWeek > 0 ? `${newThisWeek} new this week` : 'exercises with a best' };
}
