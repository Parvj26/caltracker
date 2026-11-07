// What the Food tab shows and writes, worked out on the phone: the server's meals with the queued saves and deletes
// applied on top, the operations a save or delete becomes, and the meal-time picker's steps. No network, no React.
// The macro maths (totals, targets, hints) lives in @caltracker/shared.
import { MACRO_KEYS, localDateOf, mealPhotoPaths, type IsoDate, type MacroTargets, type MealMacros } from '@caltracker/shared';
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

export type MealDraft = { day: IsoDate; minutes: number; name: string; note: string; macros: MealMacros };
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
    },
    localPhoto,
    dropPaths: pathsOf(before?.photo).filter((p) => !keep.has(p)),
  };
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
export type FoodCache = { targets: MacroTargets | null; days: Record<IsoDate, MealRecord[]> };
export const FOOD_CACHE_DAYS = 21;

export const emptyFoodCache = (): FoodCache => ({ targets: null, days: {} });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumOrNull = (v: unknown) => v === null || typeof v === 'number';
const isMacros = (v: unknown): v is MealMacros => isRecord(v) && MACRO_KEYS.every((k) => isNumOrNull(v[k]));

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
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(list)) days[day] = list.filter(isMeal);
      }
    }
    return { targets: isMacros(v.targets) ? v.targets : null, days };
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
