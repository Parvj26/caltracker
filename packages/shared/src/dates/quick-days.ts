import { addDays, isoWeekday, type IsoDate } from './dates';
import { WEEKDAYS_LONG, formatPlainDayMonth, formatPlainWeekday, formatWeekdayDay } from './format';

/** One quick-pick day in a date chooser: "Tomorrow" over "Sat 14", "Sun 15" over "Sunday", "Next Mon" over "16 Nov". */
export type QuickDay = {
  date: IsoDate;
  label: string;
  detail: string;
  /** Workouts already on that day, when the caller knows (undefined otherwise). */
  busy?: number;
};

export type QuickDayOptions = {
  /** How many days to offer (default 4). */
  count?: number;
  /** The earliest day to offer (default today). */
  min?: IsoDate;
  /** Days never offered, such as the day a workout being moved is already on. */
  exclude?: readonly IsoDate[];
  /** How many workouts a day already has; when given, each day says "free" or "1 workout". */
  workoutsOn?: (date: IsoDate) => number;
};

/** "free", "1 workout", "3 workouts". */
export const busyLabel = (n: number): string => (n === 0 ? 'free' : `${n} ${n === 1 ? 'workout' : 'workouts'}`);

/** The Monday after `today` (a week on when today is a Monday). */
const mondayAfter = (today: IsoDate) => addDays(today, 8 - isoWeekday(today));

/**
 * The days a date chooser offers before "Pick a date…": Today, Tomorrow, the next days by weekday name, and always
 * Next Mon (it takes the last place when it would fall past the count). Words come from the shared formatter only.
 */
export function quickDays(today: IsoDate, options: QuickDayOptions = {}): QuickDay[] {
  const count = Math.max(1, options.count ?? 4);
  const min = options.min && options.min > today ? options.min : today;
  const exclude = new Set(options.exclude ?? []);
  const nextMon = mondayAfter(today);
  const allowed = (d: IsoDate) => d >= min && !exclude.has(d);

  const days: IsoDate[] = [];
  for (let offset = 0; days.length < count && offset < 60; offset += 1) {
    const d = addDays(today, offset);
    if (allowed(d)) days.push(d);
  }
  if (allowed(nextMon) && !days.includes(nextMon) && days.length > 0) {
    days[days.length - 1] = nextMon;
    days.sort();
  }

  return days.map((date) => {
    const offset = date === today ? 0 : date === addDays(today, 1) ? 1 : null;
    const isNextMon = offset === null && date === nextMon;
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : isNextMon ? 'Next Mon' : formatWeekdayDay(date);
    // A weekday chip already names the day; with busy data it says only how busy it is.
    const named = offset === null && !isNextMon;
    const base = offset !== null ? formatWeekdayDay(date) : isNextMon ? formatPlainDayMonth(date) : (WEEKDAYS_LONG[isoWeekday(date) % 7] ?? '');
    if (!options.workoutsOn) return { date, label, detail: base };
    const busy = options.workoutsOn(date);
    return { date, label, detail: named ? busyLabel(busy) : `${base} · ${busyLabel(busy)}`, busy };
  });
}

/**
 * A client's status chip in a picker: their next planned workout day from today on ("Planned today", "Planned
 * tomorrow", "Planned Mon" within the week, "Planned 20 Nov" after it), or "Nothing planned".
 */
export function plannedLabel(today: IsoDate, dates: readonly IsoDate[]): string {
  const next = dates.filter((d) => d >= today).sort()[0];
  if (!next) return 'Nothing planned';
  if (next === today) return 'Planned today';
  if (next === addDays(today, 1)) return 'Planned tomorrow';
  if (next < addDays(today, 7)) return `Planned ${formatPlainWeekday(next)}`;
  return `Planned ${formatPlainDayMonth(next)}`;
}
