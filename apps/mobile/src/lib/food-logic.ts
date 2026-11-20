// What the Food tab shows and writes, worked out on the phone: the server's meals with the queued saves and deletes
// applied on top, the operations a save or delete becomes, and the meal-time picker's steps. No network, no React.
// The macro maths (totals, targets, hints) lives in @caltracker/shared.
import {
  MACRO_KEYS,
  USUAL_MEAL_MINUTES,
  addDays,
  foodDayLabel,
  hasAnyMacro,
  localDateOf,
  mealPhotoPaths,
  mealTypeForMinutes,
  type CoachMeal,
  type HistoryMeal,
  type IsoDate,
  type MacroTargets,
  type MealMacros,
  type MealSearchItem,
  type MealType,
} from '@caltracker/shared';
import type { FoodOp, LocalMealPhoto, MealRecord, StoredPhoto } from './food-queue';

export type ShownMeal = MealRecord & { pending: 'sending' | 'failed' | null; localPhoto: LocalMealPhoto | null; opId: string | null };

/** The server's meals with the queued operations applied in order (a queued delete hides a meal at once). */
export function applyFoodOps(server: ReadonlyArray<MealRecord>, ops: ReadonlyArray<FoodOp>): ShownMeal[] {
  const byId = new Map<string, ShownMeal>(server.map((m) => [m.id, { ...m, pending: null, localPhoto: null, opId: null }]));
  for (const op of ops) {
    if (op.kind === 'delete') {
      byId.delete(op.mealId);
      continue;
    }
    const before = byId.get(op.meal.id);
    byId.set(op.meal.id, {
      ...op.meal,
      pending: op.state === 'failed' || before?.pending === 'failed' ? 'failed' : 'sending',
      // A later edit that keeps the photo still shows the queued file until it is uploaded.
      localPhoto: op.localPhoto ?? (op.meal.photo && before?.photo?.path === op.meal.photo.path ? before.localPhoto : null),
      opId: op.opId,
    });
  }
  return [...byId.values()];
}

/** `coachMealId` left out keeps the edited meal's link (none for a new meal); null clears it. */
export type MealDraft = { day: IsoDate; minutes: number; name: string; note: string; macros: MealMacros; coachMealId?: string | null };
export type PhotoChoice = { kind: 'keep' } | { kind: 'none' } | { kind: 'new'; local: LocalMealPhoto; width: number; height: number };
export type OpIds = { opId: string; mealId: string; userId: string; workspaceId: string; now: string };

const pathsOf = (p: StoredPhoto | null | undefined): string[] => (p ? [p.path, p.thumbPath] : []);

/** The save a new meal (`before` null) or an edit becomes. Old photo files that the new version no longer uses are dropped after it saves. */
export function buildSaveOp(before: MealRecord | null, draft: MealDraft, photo: PhotoChoice, ids: OpIds): FoodOp & { kind: 'save' } {
  const id = before?.id ?? ids.mealId;
  const workspaceId = before?.workspaceId ?? ids.workspaceId;
  let stored: StoredPhoto | null;
  let localPhoto: LocalMealPhoto | null = null;
  if (photo.kind === 'keep') stored = before?.photo ?? null;
  else if (photo.kind === 'none') stored = null;
  else {
    // The photo's own id names its files, so a replacement never collides with the photo it replaces.
    const p = mealPhotoPaths(workspaceId, ids.userId, id, photo.local.id, photo.local.ext);
    stored = { path: p.path, thumbPath: p.thumbPath, width: Math.round(photo.width), height: Math.round(photo.height) };
    localPhoto = photo.local;
  }
  const keep = new Set(pathsOf(stored));
  const name = draft.name.trim();
  return {
    opId: ids.opId,
    createdAt: ids.now,
    state: 'sending',
    kind: 'save',
    meal: {
      id,
      workspaceId,
      eatenAt: mealInstant(draft.day, draft.minutes),
      eatenOn: draft.day,
      name: name === '' ? null : name,
      note: draft.note.trim(),
      macros: draft.macros,
      photo: stored,
      coachMealId: draft.coachMealId !== undefined ? draft.coachMealId : (before?.coachMealId ?? null),
    },
    localPhoto,
    dropPaths: pathsOf(before?.photo).filter((p) => !keep.has(p)),
  };
}

/** How many weeks the Food tab's strip pages back. */
export const MAX_WEEKS_BACK = 12;
/** Days of meals the phone keeps for search, "log again" and the strip's dots: every day the strip can reach. */
export const HISTORY_DAYS = MAX_WEEKS_BACK * 7 + 7;

/** The first day of the kept history (today included in the count). */
export function historySince(today: IsoDate): IsoDate {
  return addDays(today, -(HISTORY_DAYS - 1));
}

/** "Log again in one tap" (and Add a meal's +): a new meal on `today` at `now`, with the name, numbers and coach link. No photo, no note. */
export function logAgainOp(item: MealSearchItem, ids: OpIds, today: IsoDate, now: Date): FoodOp & { kind: 'save' } {
  return {
    opId: ids.opId,
    createdAt: ids.now,
    state: 'sending',
    kind: 'save',
    meal: {
      id: ids.mealId,
      workspaceId: ids.workspaceId,
      eatenAt: now.toISOString(),
      eatenOn: today,
      name: item.name.trim() === '' ? null : item.name,
      note: '',
      macros: item.macros,
      photo: null,
      coachMealId: item.coachMealId,
    },
    localPhoto: null,
    dropPaths: [],
  };
}

/** A meal as search and "log again" see it. */
export function historyOf(m: MealRecord): HistoryMeal {
  return { id: m.id, eatenOn: m.eatenOn, eatenAt: m.eatenAt, name: m.name, macros: m.macros, hasPhoto: m.photo !== null, coachMealId: m.coachMealId };
}

/** The server's history with the queued saves and deletes applied (a queued meal counts at once). */
export function historyWithOps(server: ReadonlyArray<HistoryMeal>, ops: ReadonlyArray<FoodOp>): HistoryMeal[] {
  const byId = new Map(server.map((m) => [m.id, m]));
  for (const op of ops) {
    if (op.kind === 'delete') byId.delete(op.mealId);
    else byId.set(op.meal.id, historyOf(op.meal));
  }
  return [...byId.values()];
}

/** The days with at least one meal (the strip's dots). */
export function mealDaysOf(history: ReadonlyArray<{ eatenOn: IsoDate }>): Set<IsoDate> {
  return new Set(history.map((m) => m.eatenOn));
}

export function buildDeleteOp(meal: MealRecord, opId: string, now: string): FoodOp & { kind: 'delete' } {
  return { opId, createdAt: now, state: 'sending', kind: 'delete', mealId: meal.id, dropPaths: pathsOf(meal.photo) };
}

/** The instant of `minutes` after midnight on a day, in the phone's time zone. */
export function mealInstant(day: IsoDate, minutes: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60).toISOString();
}

/** Minutes after midnight, in the phone's time zone. */
export function minutesOf(instant: string): number {
  const d = new Date(instant);
  return d.getHours() * 60 + d.getMinutes();
}

/** A new meal's time: now on today, noon on an earlier day. */
export function defaultMinutes(day: IsoDate, today: IsoDate, now: Date = new Date()): number {
  return day === today ? now.getHours() * 60 + now.getMinutes() : 12 * 60;
}

const STEP = 15;
const LAST = 23 * 60 + 59;

/** One tap of − or +: to the previous or next quarter hour, within the day. */
export function stepMinutes(minutes: number, direction: 1 | -1): number {
  const next = direction === 1 ? Math.floor(minutes / STEP) * STEP + STEP : Math.ceil(minutes / STEP) * STEP - STEP;
  return Math.min(LAST, Math.max(0, next));
}

/** "7:05 pm". */
export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The day switcher stops at today. */
export function clampDay(day: IsoDate, today: IsoDate): IsoDate {
  return day > today ? today : day;
}

/** What the Food tab keeps on the phone so it opens with no signal: the targets and the recent days' meals. */
export type FoodCache = {
  targets: MacroTargets | null;
  days: Record<IsoDate, MealRecord[]>;
  /** The last 90 days of meals, for search, "log again" and the strip's dots. */
  history: HistoryMeal[];
  /** The coach's live shared meals. */
  coachMeals: CoachMeal[];
};
export const FOOD_CACHE_DAYS = 21;

export const emptyFoodCache = (): FoodCache => ({ targets: null, days: {}, history: [], coachMeals: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumOrNull = (v: unknown) => v === null || typeof v === 'number';
const isMacros = (v: unknown): v is MealMacros => isRecord(v) && MACRO_KEYS.every((k) => isNumOrNull(v[k]));

const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';

function isHistory(v: unknown): v is HistoryMeal {
  return (
    isRecord(v) && typeof v.id === 'string' && typeof v.eatenOn === 'string' && typeof v.eatenAt === 'string' &&
    isStrOrNull(v.name) && isMacros(v.macros) && typeof v.hasPhoto === 'boolean' && isStrOrNull(v.coachMealId)
  );
}

function isCoachMeal(v: unknown): v is CoachMeal {
  return (
    isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && isMacros(v.macros) &&
    typeof v.ingredients === 'string' && typeof v.howTo === 'string' && typeof v.updatedAt === 'string' &&
    (v.photo === null || (isRecord(v.photo) && typeof v.photo.path === 'string' && typeof v.photo.thumbPath === 'string'))
  );
}

function isMeal(v: unknown): v is MealRecord {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.workspaceId === 'string' &&
    typeof v.eatenAt === 'string' &&
    typeof v.eatenOn === 'string' &&
    (v.name === null || typeof v.name === 'string') &&
    typeof v.note === 'string' &&
    isMacros(v.macros) &&
    (v.photo === null || (isRecord(v.photo) && typeof v.photo.path === 'string' && typeof v.photo.thumbPath === 'string'))
  );
}

export function parseFoodCache(raw: string | null): FoodCache {
  if (raw === null) return emptyFoodCache();
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return emptyFoodCache();
    const days: Record<IsoDate, MealRecord[]> = {};
    if (isRecord(v.days)) {
      for (const [day, list] of Object.entries(v.days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(list)) {
          // Copies saved before coach meals have no link.
          days[day] = list.filter(isMeal).map((m) => ({ ...m, coachMealId: typeof m.coachMealId === 'string' ? m.coachMealId : null }));
        }
      }
    }
    return {
      targets: isMacros(v.targets) ? v.targets : null,
      days,
      history: Array.isArray(v.history) ? v.history.filter(isHistory) : [],
      coachMeals: Array.isArray(v.coachMeals) ? v.coachMeals.filter(isCoachMeal) : [],
    };
  } catch {
    return emptyFoodCache();
  }
}

/** The cache with one day's meals replaced, keeping the most recent FOOD_CACHE_DAYS days. */
export function withDay(cache: FoodCache, day: IsoDate, meals: MealRecord[]): FoodCache {
  const days = { ...cache.days, [day]: meals };
  const keep = Object.keys(days).sort().slice(-FOOD_CACHE_DAYS);
  return { ...cache, days: Object.fromEntries(keep.map((d) => [d, days[d]])) };
}

export function withHistory(cache: FoodCache, history: HistoryMeal[]): FoodCache {
  return { ...cache, history };
}

export function withCoachMeals(cache: FoodCache, coachMeals: CoachMeal[]): FoodCache {
  return { ...cache, coachMeals };
}

export function withTargets(cache: FoodCache, targets: MacroTargets | null): FoodCache {
  return { ...cache, targets };
}

/** Milliseconds until the phone's next midnight (at least 1 s), for moving the Food tab on to the new day. */
export function msUntilMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * The day and time a meal is saved with. The time picked is kept as given for its day. A new meal whose time was
 * never touched, started on today (time "now"), is saved at the moment of saving instead: one started before
 * midnight and saved after it belongs to the new day, at the real time.
 */
export function savedTime(
  editor: { isNew: boolean; touched: boolean; day: IsoDate; minutes: number; openedOn: IsoDate },
  now: Date = new Date(),
): { day: IsoDate; minutes: number } {
  if (editor.isNew && !editor.touched && editor.day === editor.openedOn) {
    return { day: localDateOf(now), minutes: now.getHours() * 60 + now.getMinutes() };
  }
  return { day: editor.day, minutes: editor.minutes };
}

// ---- When a meal was eaten (Add a meal's "Lunch · Today, 1:15 PM ▾" line and its picker) ----

/** A day and a clock time (minutes after midnight) on the phone's clock. */
export type When = { day: IsoDate; minutes: number };

const DAY_MINUTES = 24 * 60;

export function whenNow(now: Date = new Date()): When {
  return { day: localDateOf(now), minutes: now.getHours() * 60 + now.getMinutes() };
}

export function whenInstant(when: When): Date {
  return new Date(mealInstant(when.day, when.minutes));
}

/**
 * One tap on a meal chip: that meal's usual time on the picked day, never a time still to come. On today, a meal whose
 * usual time hasn't come yet means the last one eaten: Lunch tapped at 9 am is yesterday's lunch, Dinner at 00:30 is
 * last night's (00:30 itself stays a snack on the new day).
 */
export function whenForMealType(type: MealType, current: When, now: Date = new Date()): When {
  const at = whenNow(now);
  const minutes = USUAL_MEAL_MINUTES[type];
  if (current.day >= at.day && minutes > at.minutes) return { day: addDays(at.day, -1), minutes };
  return { day: current.day, minutes };
}

/**
 * The time picker's − and + (15 minutes). Going past midnight moves to the day before or after, but never past the
 * end of `today` nor before the start of `oldest`.
 */
export function stepWhen(when: When, direction: 1 | -1, today: IsoDate, oldest: IsoDate): When {
  const next = direction === 1 ? Math.floor(when.minutes / STEP) * STEP + STEP : Math.ceil(when.minutes / STEP) * STEP - STEP;
  if (next < 0) return when.day <= oldest ? { day: oldest, minutes: 0 } : { day: addDays(when.day, -1), minutes: DAY_MINUTES + next };
  if (next >= DAY_MINUTES) return when.day >= today ? { day: today, minutes: LAST } : { day: addDays(when.day, 1), minutes: next - DAY_MINUTES };
  return { day: when.day, minutes: next };
}

/** "Lunch · Today, 1:15 PM" (the type comes from the time). */
export function whenLabel(when: When, today: IsoDate): string {
  return `${mealTypeForMinutes(when.minutes)} · ${foodDayLabel(when.day, today)}, ${timeLabel(when.minutes).toUpperCase()}`;
}

/** The days the picker offers, newest first: today and the six before it. */
export function pickerDays(today: IsoDate, count = 7): IsoDate[] {
  return Array.from({ length: count }, (_, i) => addDays(today, -i));
}

/** The meals "Copy yesterday's lunch" logs again: the day before's meals of the same type, earliest first. */
export function mealsToCopy(history: ReadonlyArray<HistoryMeal>, when: When): HistoryMeal[] {
  const type = mealTypeForMinutes(when.minutes);
  const before = addDays(when.day, -1);
  return history
    .filter((m) => m.eatenOn === before && (hasAnyMacro(m.macros) || !!m.name?.trim()) && mealTypeForMinutes(minutesOf(m.eatenAt)) === type)
    .sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt));
}

/** "Copy yesterday's lunch" when logging for today, otherwise "Copy lunch from the day before". */
export function copyLabel(when: When, today: IsoDate): string {
  const type = mealTypeForMinutes(when.minutes).toLowerCase();
  return when.day === today ? `Copy yesterday’s ${type}` : `Copy ${type} from the day before`;
}

/** A past meal as something Add a meal can log again (its name, numbers and coach link). */
export function copyItem(m: HistoryMeal): MealSearchItem {
  return {
    key: `copy:${m.id}`,
    source: 'own',
    name: m.name?.trim() ?? '',
    macros: m.macros,
    coachMealId: m.coachMealId,
    count: 1,
    lastEatenAt: m.eatenAt,
    lastEatenOn: m.eatenOn,
  };
}

/** Route params carrying a When to the meal form. */
export function whenParams(when: When): { day: IsoDate; minutes: string } {
  return { day: when.day, minutes: String(when.minutes) };
}

/** A When from the meal form's route, or null when absent or not usable (a future day, a bad time). */
export function whenFromParams(params: Record<string, string | string[] | undefined>, today: IsoDate): When | null {
  const day = typeof params.day === 'string' ? params.day : '';
  const minutes = typeof params.minutes === 'string' ? Number(params.minutes) : NaN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || !Number.isInteger(minutes) || minutes < 0 || minutes >= DAY_MINUTES) return null;
  return { day, minutes };
}

/** A When moved back to now if it would be later than now (a meal can't be eaten in the future). */
export function capWhen(when: When, now: Date = new Date()): When {
  const at = whenNow(now);
  return when.day > at.day || (when.day === at.day && when.minutes > at.minutes) ? at : when;
}

/** What VoiceOver says for Add a meal's +: "Log Tuna wrap for lunch today" / "… for dinner on Mon 16 Nov". */
export function logNowLabel(name: string, when: When, today: IsoDate): string {
  const label = foodDayLabel(when.day, today);
  const day = label === 'Today' ? 'today' : label === 'Yesterday' ? 'yesterday' : `on ${label}`;
  return `Log ${name} for ${mealTypeForMinutes(when.minutes).toLowerCase()} ${day}`;
}
