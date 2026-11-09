import { describe, expect, it } from 'vitest';
import { historyWithOps, logAgainOp, mealDaysOf, msUntilMidnight, savedTime, FOOD_CACHE_DAYS, emptyFoodCache, parseFoodCache, withDay, withTargets, applyFoodOps, buildDeleteOp, buildSaveOp, clampDay, defaultMinutes, mealInstant, minutesOf, stepMinutes, timeLabel } from './food-logic';
import type { FoodOp, MealRecord } from './food-queue';

const none = { calories: null, protein: null, carbs: null, fat: null };
const meal = (id: string, over: Partial<MealRecord> = {}): MealRecord => ({
  id,
  workspaceId: 'ws',
  eatenAt: '2026-11-07T12:00:00.000Z',
  eatenOn: '2026-11-07',
  name: null,
  note: '',
  macros: { ...none, protein: 20 },
  photo: null,
  coachMealId: null,
  ...over,
});
const save = (m: MealRecord, opId: string, state: 'sending' | 'failed' = 'sending'): FoodOp => ({
  opId,
  createdAt: '2026-11-07T12:00:00.000Z',
  state,
  kind: 'save',
  meal: m,
  localPhoto: null,
  dropPaths: [],
});

describe('applyFoodOps', () => {
  it('shows queued saves at once, replacing the server copy, in order', () => {
    const out = applyFoodOps([meal('a'), meal('b')], [save(meal('a', { note: 'edited' }), 'o1'), save(meal('c'), 'o2')]);
    expect(out.map((m) => [m.id, m.note, m.pending])).toEqual([
      ['a', 'edited', 'sending'],
      ['b', '', null],
      ['c', '', 'sending'],
    ]);
  });
  it('hides a meal deleted on the phone, even before the server knows', () => {
    const del: FoodOp = { opId: 'o2', createdAt: '', state: 'sending', kind: 'delete', mealId: 'a', dropPaths: [] };
    expect(applyFoodOps([meal('a')], [save(meal('a', { note: 'x' }), 'o1'), del])).toEqual([]);
  });
  it('marks a meal whose save failed', () => {
    expect(applyFoodOps([], [save(meal('a'), 'o1', 'failed')])[0].pending).toBe('failed');
  });
  it('carries the local photo of a queued save', () => {
    const op = { ...save(meal('a'), 'o1'), localPhoto: { id: 'p', fullUri: 'full.webp', thumbUri: 'thumb.webp', ext: 'webp' as const } };
    expect(applyFoodOps([], [op])[0].localPhoto?.thumbUri).toBe('thumb.webp');
  });
});

describe('buildSaveOp', () => {
  const ids = { opId: 'op', mealId: 'm1', userId: 'me', workspaceId: 'ws', now: '2026-11-07T12:00:00.000Z' };
  const draft = { day: '2026-11-07', minutes: 8 * 60 + 15, name: '  Lunch ', note: ' tasty ', macros: { ...none, protein: 30 } };
  const local = { id: 'p', fullUri: 'f.webp', thumbUri: 't.webp', ext: 'webp' as const };

  it('makes a new meal with a trimmed name and note, at the chosen local time', () => {
    const op = buildSaveOp(null, draft, { kind: 'none' }, ids);
    if (op.kind !== 'save') throw new Error('save expected');
    expect(op.meal).toMatchObject({ id: 'm1', workspaceId: 'ws', eatenOn: '2026-11-07', name: 'Lunch', note: 'tasty', photo: null });
    expect(minutesOf(op.meal.eatenAt)).toBe(8 * 60 + 15);
    expect(op.dropPaths).toEqual([]);
  });
  it('treats a blank name as no name', () => {
    const op = buildSaveOp(null, { ...draft, name: '   ' }, { kind: 'none' }, ids);
    expect(op.kind === 'save' && op.meal.name).toBeNull();
  });
  it('points a new photo at the meal\'s own folder and remembers its size', () => {
    const op = buildSaveOp(null, draft, { kind: 'new', local, width: 1200, height: 1600 }, ids);
    if (op.kind !== 'save') throw new Error('save expected');
    expect(op.meal.photo).toEqual({ path: 'ws/me/m1-p.webp', thumbPath: 'ws/me/m1-p-thumb.webp', width: 1200, height: 1600 });
    expect(op.localPhoto).toEqual(local);
  });
  it('keeps the meal id and photo on an edit', () => {
    const before = meal('old', { photo: { path: 'ws/me/old.jpg', thumbPath: 'ws/me/old-thumb.jpg', width: 10, height: 10 } });
    const op = buildSaveOp(before, draft, { kind: 'keep' }, ids);
    if (op.kind !== 'save') throw new Error('save expected');
    expect(op.meal.id).toBe('old');
    expect(op.meal.photo).toEqual(before.photo);
    expect(op.dropPaths).toEqual([]);
  });
  it('drops the old files when the photo is removed or replaced', () => {
    const before = meal('old', { photo: { path: 'ws/me/old.jpg', thumbPath: 'ws/me/old-thumb.jpg', width: 10, height: 10 } });
    const removed = buildSaveOp(before, draft, { kind: 'none' }, ids);
    expect(removed.dropPaths).toEqual(['ws/me/old.jpg', 'ws/me/old-thumb.jpg']);
    const replaced = buildSaveOp(before, draft, { kind: 'new', local, width: 5, height: 5 }, ids);
    expect(replaced.dropPaths).toEqual(['ws/me/old.jpg', 'ws/me/old-thumb.jpg']);
    // Same type: the new photo still has its own files, and the old ones go.
    const sameType = buildSaveOp(before, draft, { kind: 'new', local: { ...local, ext: 'jpg' }, width: 5, height: 5 }, ids);
    expect(sameType.meal.photo?.path).toBe('ws/me/old-p.jpg');
    expect(sameType.dropPaths).toEqual(['ws/me/old.jpg', 'ws/me/old-thumb.jpg']);
  });
});

describe('buildDeleteOp', () => {
  it('deletes the meal and its photo files', () => {
    const m = meal('a', { photo: { path: 'p.webp', thumbPath: 'p-thumb.webp', width: 1, height: 1 } });
    expect(buildDeleteOp(m, 'op', 'now')).toEqual({ opId: 'op', createdAt: 'now', state: 'sending', kind: 'delete', mealId: 'a', dropPaths: ['p.webp', 'p-thumb.webp'] });
  });
});

describe('meal times', () => {
  it('builds the instant from a local day and minutes, and reads the minutes back', () => {
    const at = mealInstant('2026-11-07', 19 * 60 + 5);
    expect(minutesOf(at)).toBe(19 * 60 + 5);
    expect(new Date(at).getDate()).toBe(7);
  });
  it('defaults to now today, and to noon on an earlier day', () => {
    const now = new Date(2026, 10, 7, 8, 42);
    expect(defaultMinutes('2026-11-07', '2026-11-07', now)).toBe(8 * 60 + 42);
    expect(defaultMinutes('2026-11-05', '2026-11-07', now)).toBe(12 * 60);
  });
  it('steps by 15 minutes within the day', () => {
    expect(stepMinutes(8 * 60 + 7, 1)).toBe(8 * 60 + 15);
    expect(stepMinutes(8 * 60 + 7, -1)).toBe(8 * 60);
    expect(stepMinutes(8 * 60, -1)).toBe(7 * 60 + 45);
    expect(stepMinutes(5, -1)).toBe(0);
    expect(stepMinutes(23 * 60 + 50, 1)).toBe(23 * 60 + 59);
  });
  it('labels minutes as a 12-hour time', () => {
    expect(timeLabel(0)).toBe('12:00 am');
    expect(timeLabel(12 * 60 + 30)).toBe('12:30 pm');
    expect(timeLabel(19 * 60 + 5)).toBe('7:05 pm');
  });
});

describe('clampDay', () => {
  it('never goes past today', () => {
    expect(clampDay('2026-11-08', '2026-11-07')).toBe('2026-11-07');
    expect(clampDay('2026-11-01', '2026-11-07')).toBe('2026-11-01');
  });
});

describe('food cache', () => {
  it('reads back what was written, and starts empty on anything unreadable', () => {
    const c = withTargets(withDay(emptyFoodCache(), '2026-11-07', [meal('a')]), { ...none, calories: 2000 });
    expect(parseFoodCache(JSON.stringify(c))).toEqual(c);
    expect(parseFoodCache('nope')).toEqual(emptyFoodCache());
    expect(parseFoodCache(null)).toEqual(emptyFoodCache());
    expect(parseFoodCache(JSON.stringify({ days: { '2026-11-07': [{ id: 1 }] } }))).toEqual({ targets: null, days: { '2026-11-07': [] }, history: [], coachMeals: [] });
  });
  it('keeps only the most recent days', () => {
    let c = emptyFoodCache();
    for (let d = 1; d <= 30; d++) c = withDay(c, `2026-10-${String(d).padStart(2, '0')}`, []);
    expect(Object.keys(c.days)).toHaveLength(FOOD_CACHE_DAYS);
    expect(Object.keys(c.days).sort()[0]).toBe(`2026-10-${String(31 - FOOD_CACHE_DAYS).padStart(2, '0')}`);
  });
});

describe('msUntilMidnight', () => {
  it('counts to just after the next midnight', () => {
    expect(msUntilMidnight(new Date(2026, 10, 7, 23, 59, 0))).toBe(61_000);
    expect(msUntilMidnight(new Date(2026, 10, 7, 0, 0, 0, 500))).toBeGreaterThan(23 * 3600_000);
  });
});

describe('savedTime', () => {
  const lateNight = { isNew: true, touched: false, day: '2026-11-07', minutes: 23 * 60 + 58, openedOn: '2026-11-07' };
  const afterMidnight = new Date(2026, 10, 8, 0, 3);
  it('saves an untouched new meal at the moment of saving, on the new day if midnight passed', () => {
    expect(savedTime(lateNight, afterMidnight)).toEqual({ day: '2026-11-08', minutes: 3 });
  });
  it('keeps a time the person picked, on its day', () => {
    expect(savedTime({ ...lateNight, touched: true, minutes: 22 * 60 }, afterMidnight)).toEqual({ day: '2026-11-07', minutes: 22 * 60 });
  });
  it('keeps an edit, and a new meal on an earlier day, as given', () => {
    expect(savedTime({ ...lateNight, isNew: false }, afterMidnight)).toEqual({ day: '2026-11-07', minutes: 23 * 60 + 58 });
    expect(savedTime({ ...lateNight, day: '2026-11-05', minutes: 720 }, afterMidnight)).toEqual({ day: '2026-11-05', minutes: 720 });
  });
});

describe('coach meal link', () => {
  const ids = { opId: 'o', mealId: 'new', userId: 'u', workspaceId: 'ws', now: '2026-11-09T12:00:00.000Z' };
  const draft = { day: '2026-11-09', minutes: 600, name: 'Protein oats', note: '', macros: { calories: 450, protein: 35, carbs: 52, fat: 11 } };
  it('a new meal from a coach meal carries the link', () => {
    expect(buildSaveOp(null, { ...draft, coachMealId: 'c1' }, { kind: 'none' }, ids).meal.coachMealId).toBe('c1');
  });
  it('an edit keeps the link when the draft passes it through', () => {
    const before = meal('a', { coachMealId: 'c1' });
    expect(buildSaveOp(before, draft, { kind: 'keep' }, ids).meal.coachMealId).toBe('c1');
    expect(buildSaveOp(before, { ...draft, coachMealId: null }, { kind: 'keep' }, ids).meal.coachMealId).toBeNull();
  });
  it('log again makes a new meal now, with the name, numbers and link but no photo or note', () => {
    const item = { key: 'k', source: 'own' as const, name: 'Greek yogurt bowl', macros: { calories: 320, protein: 28, carbs: null, fat: null }, coachMealId: 'c2', count: 3, lastEatenAt: null, lastEatenOn: null };
    const now = new Date(2026, 10, 9, 8, 30);
    const op = logAgainOp(item, ids, '2026-11-09', now);
    expect(op.meal).toMatchObject({ id: 'new', name: 'Greek yogurt bowl', note: '', photo: null, coachMealId: 'c2', eatenOn: '2026-11-09', macros: item.macros });
    expect(op.meal.eatenAt).toBe(now.toISOString());
    expect(op.localPhoto).toBeNull();
    expect(op.dropPaths).toEqual([]);
  });
});

describe('history', () => {
  const h = (id: string, eatenOn: string) => ({ id, eatenOn, eatenAt: `${eatenOn}T12:00:00.000Z`, name: 'x', macros: { ...none, calories: 1 }, hasPhoto: false, coachMealId: null });
  it('applies queued saves and deletes, so the strip shows a queued meal at once', () => {
    const del: FoodOp = { opId: 'd', createdAt: '', state: 'sending', kind: 'delete', mealId: 'a', dropPaths: [] };
    const out = historyWithOps([h('a', '2026-11-05'), h('b', '2026-11-06')], [save(meal('c', { eatenOn: '2026-11-08' }), 'o1'), del]);
    expect(out.map((m) => m.id).sort()).toEqual(['b', 'c']);
    expect([...mealDaysOf(out)].sort()).toEqual(['2026-11-06', '2026-11-08']);
  });
  it('reads old cached meals without a coach link', () => {
    const old: Record<string, unknown> = { ...meal('a') };
    delete old.coachMealId;
    const c = parseFoodCache(JSON.stringify({ targets: null, days: { '2026-11-07': [old] } }));
    expect(c.days['2026-11-07']?.[0]?.coachMealId).toBeNull();
    expect(c.history).toEqual([]);
    expect(c.coachMeals).toEqual([]);
  });
});
