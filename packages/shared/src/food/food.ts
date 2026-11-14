// Food tab rules (docs/superpowers/specs/2026-11-07-food-design.md): macro limits and parsing, daily totals against
// the coach's targets, the kcal-from-macros hint, and the labels both apps show. Pure, no time zone unless given.

import { addDays, diffDays, isoWeekday, startOfWeek, type IsoDate } from '../dates/dates';

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];
/** Calories in kcal; protein, carbs and fat in grams. Null when not entered. */
export type MealMacros = Record<MacroKey, number | null>;
/** The coach's daily targets, same units. Any may be null (left blank). */
export type MacroTargets = MealMacros;

/** Upper limits (inclusive), mirrored by the database checks on meals and nutrition_targets. */
export const MACRO_LIMITS: Record<MacroKey, number> = { calories: 10000, protein: 1000, carbs: 1000, fat: 1000 };
export const MACRO_NAMES: Record<MacroKey, string> = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
/** Short labels for the bars: kcal, P, C, F. */
export const MACRO_SHORT: Record<MacroKey, string> = { calories: 'kcal', protein: 'P', carbs: 'C', fat: 'F' };
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export const MEAL_NAME_PRESETS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;
export const MEAL_NAME_MAX = 40;
export const MEAL_NOTE_MAX = 500;
export const MEAL_PHOTO_BUCKET = 'meal-photos';

export type MealPhotoExt = 'webp' | 'jpg';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "1,234" or "1,234.5": grouped thousands without depending on the engine's locale data. */
export function group(n: number): string {
  const [whole, frac] = String(Math.abs(n)).split('.') as [string, string | undefined];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** "1,850 kcal" (whole) or "12.3 g" (at most one decimal). */
export function formatMacro(key: MacroKey, value: number): string {
  return key === 'calories' ? `${group(Math.round(value))} kcal` : `${group(round1(value))} g`;
}

export function hasAnyMacro(m: MealMacros): boolean {
  return MACRO_KEYS.some((k) => m[k] !== null);
}

export function hasAnyTarget(t: MacroTargets | null | undefined): boolean {
  return !!t && hasAnyMacro(t);
}

/** Calories worked out from protein, carbs and fat (4/4/9 per gram). Null when none of the three is filled. */
export function kcalFromMacros(m: MealMacros): number | null {
  if (m.protein === null && m.carbs === null && m.fat === null) return null;
  return Math.round((m.protein ?? 0) * KCAL_PER_GRAM.protein + (m.carbs ?? 0) * KCAL_PER_GRAM.carbs + (m.fat ?? 0) * KCAL_PER_GRAM.fat);
}

/** "≈ 500 kcal from macros" while calories are blank and other macros are filled; a hint, never saved. */
export function kcalHint(m: MealMacros): string | null {
  if (m.calories !== null) return null;
  const kcal = kcalFromMacros(m);
  return kcal === null ? null : `≈ ${group(kcal)} kcal from macros`;
}

/** A typed macro: blank is null; calories are whole, grams one decimal; 0 up to the limit. */
export function parseMacroInput(key: MacroKey, text: string): { value: number | null } | { error: string } {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { value: null };
  const n = /^\d+(\.\d*)?$|^\.\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const kcal = key === 'calories';
  if (!Number.isFinite(n)) {
    return { error: kcal ? 'Enter calories as a number.' : `Enter ${MACRO_NAMES[key].toLowerCase()} as a number of grams.` };
  }
  if (n > MACRO_LIMITS[key]) return { error: `${MACRO_NAMES[key]} can be at most ${formatMacro(key, MACRO_LIMITS[key])}.` };
  return { value: kcal ? Math.round(n) : round1(n) };
}

export type DailyTotals = Record<MacroKey, number> & { logged: Record<MacroKey, boolean>; mealCount: number };

/** Each macro added across the day's meals (blank counts as 0), and which macros any meal logged at all. */
export function dailyTotals(meals: ReadonlyArray<MealMacros>): DailyTotals {
  const sums: Record<MacroKey, number> = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const logged: Record<MacroKey, boolean> = { calories: false, protein: false, carbs: false, fat: false };
  for (const m of meals) {
    for (const k of MACRO_KEYS) {
      const v = m[k];
      if (v === null) continue;
      sums[k] += v;
      logged[k] = true;
    }
  }
  return {
    calories: Math.round(sums.calories),
    protein: round1(sums.protein),
    carbs: round1(sums.carbs),
    fat: round1(sums.fat),
    logged,
    mealCount: meals.length,
  };
}

export type MacroProgress = { total: number; target: number | null; fraction: number | null; over: boolean; remaining: number | null };

/** How far a total is towards its target: the bar's fill (0–1), whether it went over, and what is left. */
export function macroProgress(total: number, target: number | null): MacroProgress {
  if (target === null) return { total, target, fraction: null, over: false, remaining: null };
  if (target <= 0) return { total, target, fraction: null, over: total > target, remaining: 0 };
  return {
    total,
    target,
    fraction: Math.min(1, total / target),
    over: total > target,
    remaining: Math.max(0, round1(target - total)),
  };
}

/** "860 left", "140 over" or "on target" for calories ("12.5 g left" for grams); null without a target. */
export function targetGap(key: MacroKey, total: number, target: number | null): string | null {
  if (target === null || target <= 0) return null;
  const diff = round1(target - total);
  if (diff === 0) return 'on target';
  const amount = key === 'calories' ? group(Math.round(Math.abs(diff))) : formatMacro(key, Math.abs(diff));
  return `${amount} ${diff < 0 ? 'over' : 'left'}`;
}

/** Why a meal cannot be saved yet (empty when it can). */
export function mealProblems(draft: { macros: MealMacros; hasPhoto: boolean; name: string; note: string }): string[] {
  const out: string[] = [];
  if (!draft.hasPhoto && !hasAnyMacro(draft.macros)) out.push('Add a photo or at least one of calories, protein, carbs or fat.');
  if (draft.name.trim().length > MEAL_NAME_MAX) out.push(`Keep the name to ${MEAL_NAME_MAX} characters.`);
  if (draft.note.trim().length > MEAL_NOTE_MAX) out.push(`Keep the note to ${MEAL_NOTE_MAX} characters.`);
  return out;
}

/**
 * `{workspace}/{client}/{meal}-{photo}.{ext}` and its `-thumb.{ext}` in the meal-photos bucket (the database checks
 * this). The photo's own id means a replaced photo gets new files: uploads never overwrite, and the old ones are deleted.
 */
export function mealPhotoPaths(
  workspaceId: string,
  clientId: string,
  mealId: string,
  photoId: string,
  ext: MealPhotoExt,
): { path: string; thumbPath: string } {
  const base = `${workspaceId}/${clientId}/${mealId}-${photoId}`;
  return { path: `${base}.${ext}`, thumbPath: `${base}-thumb.${ext}` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Tue 3 Nov", with the year when it is not this year. */
export function shortDayLabel(day: IsoDate, today: IsoDate): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const base = `${WEEKDAYS[isoWeekday(day) - 1]} ${d} ${MONTHS[m - 1]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${y}`;
}

/** The day switcher's label: Today, Yesterday, or "Tue 3 Nov". */
export function foodDayLabel(day: IsoDate, today: IsoDate): string {
  const back = diffDays(day, today);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  return shortDayLabel(day, today);
}

/** Monday to Sunday of the week holding `day`. */
export function weekDays(day: IsoDate): IsoDate[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Meals grouped by their day (only the given days), earliest first within a day. */
export function mealsByDay<T extends { id: string; eatenOn: IsoDate; eatenAt: string }>(meals: ReadonlyArray<T>, days: ReadonlyArray<IsoDate>): Record<IsoDate, T[]> {
  const out: Record<IsoDate, T[]> = Object.fromEntries(days.map((d) => [d, [] as T[]]));
  for (const m of meals) out[m.eatenOn]?.push(m);
  for (const d of days) {
    out[d]!.sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return out;
}

/** "8:10 am" in the given time zone (default: the viewer's). Built from parts, so it works without full ICU data. */
export function formatMealTime(instant: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', numberingSystem: 'latn' }).formatToParts(new Date(instant));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

/** The start of a coach's message about a meal: "About your Lunch on Tue 3 Nov (12:15 pm): ". */
export function mealReference(meal: { name: string | null; eatenOn: IsoDate; eatenAt: string }, today: IsoDate, timeZone?: string): string {
  const what = meal.name?.trim() ? meal.name.trim() : 'meal';
  const label = foodDayLabel(meal.eatenOn, today);
  const when = label === 'Today' ? 'today' : label === 'Yesterday' ? 'yesterday' : `on ${label}`;
  return `About your ${what} ${when} (${formatMealTime(meal.eatenAt, timeZone)}): `;
}

/**
 * The Today tab's food line: today's calories and protein against their targets ("650 of 2,000 kcal",
 * "42 of 150 g protein"), plain where a target is blank. Null with no targets and no meals (nothing to say).
 */
export function todayFoodSummary(totals: DailyTotals, targets: MacroTargets | null): { calories: string; protein: string } | null {
  if (totals.mealCount === 0 && !hasAnyTarget(targets)) return null;
  const of = (key: 'calories' | 'protein') => {
    const target = targets?.[key] ?? null;
    const unit = key === 'calories' ? '' : ' protein';
    return target === null ? `${formatMacro(key, totals[key])}${unit}` : `${formatMacro(key, totals[key]).replace(/ (kcal|g)$/, '')} of ${formatMacro(key, target)}${unit}`;
  };
  return { calories: of('calories'), protein: of('protein') };
}

/** "650 kcal · P 42 g · F 12.5 g": only the macros that were entered. Empty when none were. */
export function mealMacroLine(m: MealMacros): string {
  return MACRO_KEYS.filter((k) => m[k] !== null)
    .map((k) => (k === 'calories' ? formatMacro(k, m[k]!) : `${MACRO_SHORT[k]} ${formatMacro(k, m[k]!)}`))
    .join(' · ');
}

export type KcalCard = {
  /** The big number: kcal left or over (with a calorie target), otherwise the day's total. */
  headline: string;
  /** The words after it: "kcal left today", "kcal over on Tue 3 Nov", "kcal today". */
  caption: string;
  bars: Array<{ key: 'protein' | 'carbs' | 'fat'; text: string; fraction: number | null }>;
  /** Any target set (the screen then says who set them, otherwise "Your coach hasn't set targets yet"). */
  hasTargets: boolean;
};

/** The Food tab's lime card for one day. */
export function kcalCard(totals: DailyTotals, targets: MacroTargets | null, day: IsoDate, today: IsoDate): KcalCard {
  const when = day === today ? 'today' : `on ${shortDayLabel(day, today)}`;
  const kcalTarget = targets?.calories ?? null;
  let headline: string;
  let caption: string;
  if (kcalTarget === null) {
    headline = group(totals.calories);
    caption = `kcal ${when}`;
  } else {
    const diff = Math.round(kcalTarget - totals.calories);
    headline = group(Math.abs(diff));
    caption = diff < 0 ? `kcal over ${when}` : `kcal left ${when}`;
  }
  const bars = (['protein', 'carbs', 'fat'] as const).map((key) => {
    const total = totals[key];
    const target = targets?.[key] ?? null;
    if (target === null) return { key, text: `${group(total)} g`, fraction: null };
    const p = macroProgress(total, target);
    const diff = round1(Math.abs(target - total));
    return {
      key,
      text: `${group(total)} / ${group(target)} g · ${group(diff)} ${total > target ? 'over' : 'left'}`,
      fraction: p.fraction ?? (total > 0 ? 1 : 0),
    };
  });
  return { headline, caption, bars, hasTargets: hasAnyTarget(targets) };
}

export type StripDay = { day: IsoDate; dow: string; num: number; hasMeals: boolean; isToday: boolean };

/**
 * Seven days for the Food tab's strip, oldest first. `weeksBack` 0 ends today; 1 is the seven days before that, and so
 * on (the strip's back arrow). Never a day after today.
 */
export function dayStrip(today: IsoDate, mealDays: ReadonlySet<IsoDate>, weeksBack = 0): StripDay[] {
  const end = addDays(today, -7 * Math.max(0, Math.floor(weeksBack)));
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(end, i - 6);
    return {
      day,
      dow: WEEKDAYS[isoWeekday(day) - 1] as string,
      num: Number(day.slice(8, 10)),
      hasMeals: mealDays.has(day),
      isToday: day === today,
    };
  });
}
