import { describe, expect, it } from 'vitest';
import type { FoodOp } from './food-queue';
import { GONE, SAVE_REFUSED, mealFields, sendFoodOpWith, type FoodBackend } from './food-send';
import { parseFoodQueue } from './food-queue';
import { OutboxSendError } from './outbox';

const photo = { path: 'ws/me/m-p2.webp', thumbPath: 'ws/me/m-p2-thumb.webp', width: 10, height: 10 };
const save = (over: Partial<FoodOp & { kind: 'save' }> = {}): FoodOp => ({
  opId: 'o',
  createdAt: '2026-11-07T12:00:00.000Z',
  state: 'sending',
  kind: 'save',
  meal: {
    id: 'm',
    workspaceId: 'ws',
    eatenAt: '2026-11-07T12:00:00.000Z',
    eatenOn: '2026-11-07',
    name: 'Lunch',
    note: '',
    macros: { calories: 500, protein: null, carbs: null, fat: null },
    photo,
    coachMealId: null,
  },
  localPhoto: { id: 'p2', fullUri: 'p2.webp', thumbUri: 'p2-thumb.webp', ext: 'webp' },
  dropPaths: ['ws/me/m-p1.webp', 'ws/me/m-p1-thumb.webp'],
  ...over,
});

function fakeDb(over: Partial<FoodBackend> = {}) {
  const calls: string[] = [];
  const db: FoodBackend = {
    deleteMeal: (id) => (calls.push(`delete ${id}`), Promise.resolve(null)),
    insertMeal: (row) => (calls.push(`insert ${row.id} ${row.photo_path}`), Promise.resolve(null)),
    updateMeal: (id) => (calls.push(`update ${id}`), Promise.resolve({ error: null, rows: 1 })),
    upload: (path) => (calls.push(`upload ${path}`), Promise.resolve()),
    removeQuietly: (paths) => (calls.push(`remove ${paths.join(',')}`), Promise.resolve()),
    ...over,
  };
  return { db, calls };
}

describe('sendFoodOpWith', () => {
  it('uploads a replacement photo to its own files, saves the meal, then removes the old files', async () => {
    const { db, calls } = fakeDb();
    await sendFoodOpWith(db, save());
    expect(calls).toEqual([
      'upload ws/me/m-p2.webp',
      'upload ws/me/m-p2-thumb.webp',
      'insert m ws/me/m-p2.webp',
      'remove ws/me/m-p1.webp,ws/me/m-p1-thumb.webp',
    ]);
  });

  it('updates a meal that is already there', async () => {
    const { db, calls } = fakeDb({ insertMeal: () => Promise.resolve(({ code: '23505', message: 'duplicate' })) });
    await sendFoodOpWith(db, save({ localPhoto: null }));
    expect(calls).toEqual(['update m', 'remove ws/me/m-p1.webp,ws/me/m-p1-thumb.webp']);
  });

  it('refuses (Retry / Discard) when the update changes nothing, and keeps the old files', async () => {
    const { db, calls } = fakeDb({
      insertMeal: () => Promise.resolve(({ code: '23505', message: 'duplicate' })),
      updateMeal: () => Promise.resolve(({ error: null, rows: 0 })),
    });
    await expect(sendFoodOpWith(db, save({ localPhoto: null }))).rejects.toEqual(new OutboxSendError('refused', GONE));
    expect(calls.some((c) => c.startsWith('remove'))).toBe(false);
  });

  it('retries later when there is no signal, and refuses other errors', async () => {
    const offline = fakeDb({ insertMeal: () => Promise.resolve(({ code: '', message: 'TypeError: Network request failed' })) });
    await expect(sendFoodOpWith(offline.db, save())).rejects.toMatchObject({ kind: 'network' });
    const refused = fakeDb({ insertMeal: () => Promise.resolve(({ code: '23514', message: 'check' })) });
    await expect(sendFoodOpWith(refused.db, save())).rejects.toEqual(new OutboxSendError('refused', SAVE_REFUSED));
  });

  it('deletes a meal, then its photo files', async () => {
    const { db, calls } = fakeDb();
    await sendFoodOpWith(db, { opId: 'd', createdAt: '', state: 'sending', kind: 'delete', mealId: 'm', dropPaths: ['a.webp'] });
    expect(calls).toEqual(['delete m', 'remove a.webp']);
  });
});

describe('mealFields', () => {
  it('sends the coach link', () => {
    const op = save() as FoodOp & { kind: 'save' };
    expect(mealFields({ ...op, meal: { ...op.meal, coachMealId: 'c1' } }).coach_meal_id).toBe('c1');
  });
  it('sends no link for a save queued by the previous app version', () => {
    const op = save() as FoodOp & { kind: 'save' };
    const oldMeal: Record<string, unknown> = { ...op.meal };
    delete oldMeal.coachMealId;
    const [parsed] = parseFoodQueue(JSON.stringify([{ ...op, meal: oldMeal }]));
    expect(parsed?.kind === 'save' && mealFields(parsed).coach_meal_id).toBeNull();
  });
});
