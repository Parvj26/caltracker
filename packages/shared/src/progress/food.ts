import { addDays, isoWeekday } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { MACRO_KEYS, MACRO_NAMES, dailyTotals, formatMacro, hasAnyTarget, macroProgress, mealsByDay, weekDays } from '../food/food';
import type { MacroKey, MacroTargets, MealMacros } from '../food/food';

/**
 * The client's Food screen on Progress: the daily average of each macro against the coach's targets, and which days
 * reached the protein target. A day counts as "hit" once its protein total reaches the target.
 */

export type FoodPeriod = 'week' | '4w';
export const FOOD_PERIOD_LABELS: Record<FoodPeriod, string> = { week: 'This week', '4w': 'Last 4 weeks' };

/** This week Monday to Sunday, or the 28 days up to today. */
export function foodPeriodDays(period: FoodPeriod, today: IsoDate): IsoDate[] {
  if (period === 'week') return weekDays(today);
  return Array.from({ length: 28 }, (_, i) => addDays(today, i - 27));
}

export type FoodMealLite = { eatenOn: IsoDate; macros: MealMacros; hasPhoto: boolean };
export type ProteinDayState = 'hit' | 'under' | 'none' | 'future';

export type FoodMacroRow = {
  key: MacroKey;
  name: string;
  /** Average per day over the days it was logged, or null when it never was. */
  average: number | null;
  target: number | null;
  /** The bar's fill (0–1), or null without a target or average. */
  fraction: number | null;
  /** "1,950 / 2,100 kcal", "1,950 kcal", or "Not logged". */
  text: string;
  label: string;
};

export type FoodPeriodSummary = {
  hasTargets: boolean;
  macros: FoodMacroRow[];
  /** One per day, or null without a protein target. */
  proteinDays: { date: IsoDate; dow: string; state: ProteinDayState; label: string }[] | null;
  loggedDays: number;
  /** Days with protein entered (the only days judged against the protein target). */
  proteinLoggedDays: number;
  hitDays: number;
  mealCount: number;
  photoCount: number;
  sentence: string;
};

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function foodPeriodSummary(
  meals: readonly FoodMealLite[],
  targets: MacroTargets | null,
  days: readonly IsoDate[],
  today: IsoDate,
): FoodPeriodSummary {
  const keyed = meals.map((m, i) => ({ ...m, id: String(i), eatenAt: '' }));
  const byDay = mealsByDay(keyed, days);
  const totals = days.map((d) => ({ date: d, meals: byDay[d] ?? [], totals: dailyTotals((byDay[d] ?? []).map((m) => m.macros)) }));
  const logged = totals.filter((t) => t.meals.length > 0);

  const macros = MACRO_KEYS.map((key): FoodMacroRow => {
    const withKey = logged.filter((t) => t.totals.logged[key]);
    const average = withKey.length === 0 ? null : Math.round(withKey.reduce((s, t) => s + t.totals[key], 0) / withKey.length);
    const target = targets?.[key] ?? null;
    const progress = average === null ? null : macroProgress(average, target);
    const fraction = progress?.fraction ?? null;
    const name = MACRO_NAMES[key];
    if (average === null) return { key, name, average, target, fraction: null, text: 'Not logged', label: `${name}: not logged` };
    const text = target === null ? formatMacro(key, average) : `${formatMacro(key, average).replace(/ (kcal|g)$/, '')} / ${formatMacro(key, target)}`;
    const share = target !== null && target > 0 ? `, ${Math.round((average / target) * 100)}% of target` : '';
    return { key, name, average, target, fraction, text, label: `${name}: ${formatMacro(key, average)} a day on average${share}` };
  });

  // A target of 0 can't be hit or missed: show the averages only.
  const proteinTarget = targets?.protein ?? null;
  const proteinDays =
    proteinTarget === null || proteinTarget <= 0
      ? null
      : totals.map((t) => {
          const dow = DOW[isoWeekday(t.date) - 1]!;
          const state: ProteinDayState =
            t.date > today ? 'future' : !t.totals.logged.protein ? 'none' : t.totals.protein >= proteinTarget ? 'hit' : 'under';
          const label =
            state === 'hit'
              ? `${dow}: protein target hit`
              : state === 'under'
                ? `${dow}: logged, under target`
                : state === 'none'
                  ? t.meals.length === 0
                    ? `${dow}: nothing logged`
                    : `${dow}: no protein logged`
                  : `${dow}: still to come`;
          return { date: t.date, dow, state, label };
        });
  const hitDays = proteinDays?.filter((d) => d.state === 'hit').length ?? 0;
  const loggedDays = logged.length;
  const proteinLoggedDays = logged.filter((t) => t.totals.logged.protein).length;

  let sentence: string;
  if (loggedDays === 0) sentence = 'No meals logged in this period yet.';
  else if (proteinDays === null) sentence = `Logged on ${loggedDays} ${loggedDays === 1 ? 'day' : 'days'}. Every meal helps your coach help you.`;
  else if (proteinLoggedDays === 0) sentence = `Logged on ${loggedDays} ${loggedDays === 1 ? 'day' : 'days'}. Add protein to see your target days.`;
  else
    sentence = `Hit on ${hitDays} of ${proteinLoggedDays} ${proteinLoggedDays === 1 ? 'day' : 'days'} logged.${hitDays * 2 >= proteinLoggedDays && hitDays > 0 ? ' Nice.' : ''}`;

  return {
    hasTargets: hasAnyTarget(targets),
    macros,
    proteinDays,
    loggedDays,
    proteinLoggedDays,
    hitDays,
    mealCount: logged.reduce((s, t) => s + t.meals.length, 0),
    photoCount: logged.reduce((s, t) => s + t.meals.filter((m) => m.hasPhoto).length, 0),
    sentence,
  };
}

/** The Food tile on Progress, for this week. `loggedDays` are the days with protein entered. */
export function foodTile(s: { hitDays: number; loggedDays: number; mealCount: number; hasProteinTarget: boolean }): { value: string; sub: string } {
  if (s.mealCount === 0) return { value: 'No meals yet', sub: 'this week' };
  if (s.hasProteinTarget && s.loggedDays > 0) return { value: `${s.hitDays} of ${s.loggedDays}`, sub: 'days on protein target' };
  return { value: s.mealCount === 1 ? '1 meal' : `${s.mealCount} meals`, sub: 'logged this week' };
}
