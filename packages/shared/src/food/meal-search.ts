// Meal search, "Log again in one tap" and the coach meal filter chips
// (docs/superpowers/specs/2026-11-09-food-and-coach-meals-design.md, decisions 1-3 and 10).

import { addDays, diffDays, type IsoDate } from '../dates/dates';
import { buildSmartIndex, normalizeSearchText, smartMatch } from '../search/smart-search';
import { compactMacroLine } from './coach-meals';
import { hasAnyMacro, MACRO_KEYS, shortDayLabel, type MealMacros } from './food';

/** One of the client's own past meals, as the phone keeps it for search and "log again". */
export type HistoryMeal = {
  id: string;
  eatenOn: IsoDate;
  eatenAt: string;
  name: string | null;
  macros: MealMacros;
  hasPhoto: boolean;
  coachMealId: string | null;
};

export type CoachMealPhoto = { path: string; thumbPath: string; width: number; height: number };

/** A live meal the coach shares with every client. */
export type CoachMeal = {
  id: string;
  name: string;
  macros: MealMacros;
  ingredients: string;
  howTo: string;
  photo: CoachMealPhoto | null;
  updatedAt: string;
};

/** Something the client can pick to fill a meal: a kind of own meal, or a coach meal. */
export type MealSearchItem = {
  key: string;
  source: 'own' | 'coach';
  name: string;
  macros: MealMacros;
  coachMealId: string | null;
  /** Times logged in the window (own meals; for a coach meal, the client's meals logged from it). */
  count: number;
  lastEatenAt: string | null;
  lastEatenOn: IsoDate | null;
};

const WINDOW_LOG_AGAIN = 28;
const WINDOW_SEARCH = 90;
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base' });
const byName = (a: string, b: string) => COLLATOR.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** Meals of one "kind": same normalised name and the same four numbers. */
function kindKey(name: string, m: MealMacros): string {
  return `${normalizeSearchText(name)}|${MACRO_KEYS.map((k) => m[k] ?? '').join('|')}`;
}

/** Named meals with at least one macro within `days` days (today included), grouped by kind. */
function ownGroups(history: readonly HistoryMeal[], today: IsoDate, days: number): MealSearchItem[] {
  const from = addDays(today, -(days - 1));
  const groups = new Map<string, MealSearchItem>();
  for (const m of history) {
    const name = m.name?.trim();
    if (!name || !hasAnyMacro(m.macros) || m.eatenOn < from) continue;
    const key = kindKey(name, m.macros);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key: `own:${key}`,
        source: 'own',
        name,
        macros: m.macros,
        coachMealId: m.coachMealId,
        count: 1,
        lastEatenAt: m.eatenAt,
        lastEatenOn: m.eatenOn,
      });
      continue;
    }
    g.count += 1;
    if (g.lastEatenAt === null || Date.parse(m.eatenAt) > Date.parse(g.lastEatenAt)) {
      g.name = name;
      g.coachMealId = m.coachMealId;
      g.lastEatenAt = m.eatenAt;
      g.lastEatenOn = m.eatenOn;
    }
  }
  return [...groups.values()];
}

const recency = (a: MealSearchItem) => (a.lastEatenAt === null ? -Infinity : Date.parse(a.lastEatenAt));
/** Most logged, then most recent, then own before coach, then A to Z. */
function compareItems(a: MealSearchItem, b: MealSearchItem): number {
  return (
    b.count - a.count ||
    recency(b) - recency(a) ||
    (a.source === b.source ? 0 : a.source === 'own' ? -1 : 1) ||
    byName(a.name, b.name)
  );
}

/** "Log again in one tap": the client's most logged kinds of meal in the last 28 days (default up to 3). */
export function frequentMeals(
  history: readonly HistoryMeal[],
  today: IsoDate,
  opts: { days?: number; limit?: number } = {},
): MealSearchItem[] {
  return ownGroups(history, today, opts.days ?? WINDOW_LOG_AGAIN)
    .sort(compareItems)
    .slice(0, opts.limit ?? 3);
}

/**
 * Everything Log a meal can search: own kinds of meal from the last 90 days, plus the coach's meals. Own meals
 * logged from a listed coach meal fold into it (their count and recency boost it) instead of showing twice.
 */
export function mealSearchItems(history: readonly HistoryMeal[], coach: readonly CoachMeal[], today: IsoDate): MealSearchItem[] {
  const coachItems = new Map<string, MealSearchItem>(
    coach.map((c) => [
      c.id,
      { key: `coach:${c.id}`, source: 'coach', name: c.name, macros: c.macros, coachMealId: c.id, count: 0, lastEatenAt: null, lastEatenOn: null },
    ]),
  );
  const own: MealSearchItem[] = [];
  for (const g of ownGroups(history, today, WINDOW_SEARCH)) {
    const c = g.coachMealId === null ? undefined : coachItems.get(g.coachMealId);
    if (!c) {
      own.push(g);
      continue;
    }
    c.count += g.count;
    if (g.lastEatenAt !== null && (c.lastEatenAt === null || Date.parse(g.lastEatenAt) > Date.parse(c.lastEatenAt))) {
      c.lastEatenAt = g.lastEatenAt;
      c.lastEatenOn = g.lastEatenOn;
    }
  }
  return [...own, ...coachItems.values()];
}

/** Log a meal's results: nothing until something is typed, best match tier first, then compareItems. */
export function searchMeals(items: readonly MealSearchItem[], query: string, limit = 8): MealSearchItem[] {
  const index = buildSmartIndex(items, (i) => ({ name: i.name }));
  return smartMatch(index, query)
    .sort((a, b) => a.tier - b.tier || compareItems(a.item, b.item))
    .slice(0, limit)
    .map((h) => h.item);
}

/** The grey line under a result: "610 kcal · 48 P · 62 C · 14 F · logged 6 times" / "· last Thu" / "· recipe". */
export function mealSearchMeta(item: MealSearchItem, today: IsoDate): string {
  const macros = compactMacroLine(item.macros);
  let tail: string;
  if (item.source === 'coach') tail = 'recipe';
  else if (item.count >= 2) tail = `logged ${item.count} times`;
  else if (item.lastEatenOn === null) tail = '';
  else {
    const back = diffDays(item.lastEatenOn, today);
    const label = shortDayLabel(item.lastEatenOn, today);
    tail = back <= 0 ? 'today' : back === 1 ? 'yesterday' : back < 7 ? `last ${label.slice(0, 3)}` : label;
  }
  return [macros, tail].filter(Boolean).join(' · ');
}

export type CoachMealChip = 'highProtein' | 'under500' | 'lowCarb';
export const COACH_MEAL_CHIPS: readonly { id: CoachMealChip; label: string }[] = [
  { id: 'highProtein', label: 'High protein' },
  { id: 'under500', label: 'Under 500 kcal' },
  { id: 'lowCarb', label: 'Low carb' },
];

const CHIP_TEST: Record<CoachMealChip, (m: MealMacros) => boolean> = {
  highProtein: (m) => m.protein !== null && m.protein >= 30,
  under500: (m) => m.calories !== null && m.calories <= 500,
  lowCarb: (m) => m.carbs !== null && m.carbs <= 20,
};

/** Meals from <coach>: the chips (all must match) and the search; A to Z with no search, by match tier with one. */
export function filterCoachMeals(meals: readonly CoachMeal[], query: string, chips: ReadonlySet<CoachMealChip>): CoachMeal[] {
  const passing = meals.filter((m) => [...chips].every((c) => CHIP_TEST[c](m.macros)));
  if (normalizeSearchText(query) === '') return [...passing].sort((a, b) => byName(a.name, b.name));
  return smartMatch(buildSmartIndex(passing, (m) => ({ name: m.name })), query)
    .sort((a, b) => a.tier - b.tier || byName(a.item.name, b.item.name))
    .map((h) => h.item);
}
