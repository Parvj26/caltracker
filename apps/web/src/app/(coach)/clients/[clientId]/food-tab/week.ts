import {
  IsoDateSchema,
  MACRO_KEYS,
  dailyTotals,
  macroProgress,
  parseMacroInput,
  startOfWeek,
  targetGap,
  type IsoDate,
  type MacroKey,
  type MacroTargets,
  type MealMacros,
} from '@caltracker/shared';

/** The Monday of the week to show: `?week=` when it is a real date not in a future week, else this week. */
export function weekFromParam(raw: string | string[] | undefined, today: IsoDate): IsoDate {
  const thisWeek = startOfWeek(today);
  if (typeof raw !== 'string' || !IsoDateSchema.safeParse(raw).success) return thisWeek;
  const monday = startOfWeek(raw);
  return monday > thisWeek ? thisWeek : monday;
}

export type TargetsParse = { ok: true; value: MacroTargets } | { ok: false; errors: Partial<Record<MacroKey, string>> };

/** The targets form: each field is a number in range or blank (no target). */
export function parseTargetsForm(input: Partial<Record<MacroKey, unknown>>): TargetsParse {
  const value: MacroTargets = { calories: null, protein: null, carbs: null, fat: null };
  const errors: Partial<Record<MacroKey, string>> = {};
  for (const k of MACRO_KEYS) {
    const raw = input[k];
    const r = parseMacroInput(k, typeof raw === 'string' ? raw : '');
    if ('error' in r) errors[k] = r.error;
    else value[k] = r.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** The cookie the coach's browser keeps its time zone in, so the server picks the coach's own "this week". */
export const TIME_ZONE_COOKIE = 'ct-tz';

/** A real IANA time zone name, or null. */
export function validTimeZone(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

export type WeekRow = {
  day: IsoDate;
  isToday: boolean;
  /** `future`: still to come ("Not yet"); `empty`: passed with no meals; `meals`: at least one meal. */
  state: 'future' | 'empty' | 'meals';
  calories: number;
  mealCount: number;
  /** The thin bar's fill against the calorie target (0–1), or null without one. */
  fraction: number | null;
  /** "140 over" when the day went past the calorie target, else null. */
  over: string | null;
};

/** The Food tab's week on phones: one row per day, Monday to Sunday, with its calories against the target. */
export function weekRows(days: IsoDate[], byDay: Record<IsoDate, ReadonlyArray<{ macros: MealMacros }>>, today: IsoDate, kcalTarget: number | null): WeekRow[] {
  return days.map((day) => {
    const meals = byDay[day] ?? [];
    const totals = dailyTotals(meals.map((m) => m.macros));
    const p = macroProgress(totals.calories, kcalTarget);
    return {
      day,
      isToday: day === today,
      state: meals.length > 0 ? 'meals' : day > today ? 'future' : 'empty',
      calories: totals.calories,
      mealCount: meals.length,
      fraction: p.fraction,
      over: p.over ? targetGap('calories', totals.calories, kcalTarget) : null,
    };
  });
}
