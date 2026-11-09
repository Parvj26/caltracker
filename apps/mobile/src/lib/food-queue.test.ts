import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './log-fixtures';
import { OutboxSendError } from './outbox';
import { createFoodQueue, foodQueueKey, parseFoodQueue, type FoodOp } from './food-queue';

const save = (opId: string, mealId = `meal-${opId}`): FoodOp => ({
  opId,
  createdAt: '2026-11-07T12:00:00.000Z',
  state: 'sending',
  kind: 'save',
  meal: {
    id: mealId,
    workspaceId: 'ws',
    eatenAt: '2026-11-07T12:00:00.000Z',
    eatenOn: '2026-11-07',
    name: null,
    note: '',
    macros: { calories: 400, protein: null, carbs: null, fat: null },
    photo: null,
    coachMealId: null,
  },
  localPhoto: null,
  dropPaths: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('parseFoodQueue', () => {
  it('reads a save queued by the previous app version (no coach link) as not linked', () => {
    const legacy = save('old') as FoodOp & { kind: 'save' };
    const oldMeal: Record<string, unknown> = { ...legacy.meal };
    delete oldMeal.coachMealId;
    const parsed = parseFoodQueue(JSON.stringify([{ ...legacy, meal: oldMeal }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.kind === 'save' && parsed[0].meal.coachMealId).toBeNull();
  });
  it('keeps a coach link', () => {
    const op = save('new') as FoodOp & { kind: 'save' };
    const parsed = parseFoodQueue(JSON.stringify([{ ...op, meal: { ...op.meal, coachMealId: 'c1' } }]));
    expect(parsed[0]?.kind === 'save' && parsed[0].meal.coachMealId).toBe('c1');
  });
});

describe('food queue', () => {
  it('keeps a queued save on the phone and sends it', async () => {
    const storage = memoryStorage();
    const send = vi.fn().mockResolvedValue(undefined);
    const q = createFoodQueue({ storage, userId: 'u', workspaceId: 'ws', send });
    await q.enqueue(save('a'));
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.items()).toEqual([]);
    expect(storage.map.get(foodQueueKey('u', 'ws'))).toBe('[]');
  });

  it('survives a restart and sends later', async () => {
    const storage = memoryStorage();
    const first = createFoodQueue({ storage, userId: 'u', workspaceId: 'ws', send: vi.fn().mockRejectedValue(new OutboxSendError('network', 'offline')) });
    await first.enqueue(save('a'));
    await first.flush();
    first.stop();
    const send = vi.fn().mockResolvedValue(undefined);
    const second = createFoodQueue({ storage, userId: 'u', workspaceId: 'ws', send });
    expect((await second.load()).map((o) => o.opId)).toEqual(['a']);
    await second.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(second.items()).toEqual([]);
  });

  it('retries no signal with the message backoff', async () => {
    const send = vi.fn().mockRejectedValue(new OutboxSendError('network', 'offline'));
    const q = createFoodQueue({ storage: memoryStorage(), userId: 'u', workspaceId: 'ws', send });
    await q.enqueue(save('a'));
    await q.flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('sends in order, and a failed save holds back later operations on the same meal only', async () => {
    const sent: string[] = [];
    const send = vi.fn((op: FoodOp) => {
      if (op.opId === 'a1') return Promise.reject(new OutboxSendError('refused', 'No'));
      sent.push(op.opId);
      return Promise.resolve();
    });
    const q = createFoodQueue({ storage: memoryStorage(), userId: 'u', workspaceId: 'ws', send });
    await q.enqueue(save('a1', 'A'));
    await q.enqueue(save('b1', 'B'));
    await q.enqueue(save('a2', 'A'));
    await q.flush();
    expect(sent).toEqual(['b1']);
    expect(q.items().map((o) => [o.opId, o.state, o.error])).toEqual([
      ['a1', 'failed', 'No'],
      ['a2', 'sending', undefined],
    ]);

    send.mockImplementation((op: FoodOp) => {
      sent.push(op.opId);
      return Promise.resolve();
    });
    await q.retry('a1');
    expect(sent).toEqual(['b1', 'a1', 'a2']);
    expect(q.items()).toEqual([]);
  });

  it('discards a failed operation, and only a failed one', async () => {
    const onRemoved = vi.fn();
    const q = createFoodQueue({
      storage: memoryStorage(),
      userId: 'u',
      workspaceId: 'ws',
      send: vi.fn().mockRejectedValue(new OutboxSendError('photo', 'bad photo')),
      onRemoved,
    });
    await q.enqueue(save('a'));
    await q.remove('a');
    expect(q.items()).toHaveLength(1);
    await q.flush();
    await q.remove('a');
    expect(q.items()).toEqual([]);
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated enqueue and unreadable storage', async () => {
    const q = createFoodQueue({ storage: memoryStorage(), userId: 'u', workspaceId: 'ws', send: vi.fn().mockRejectedValue(new OutboxSendError('network', 'x')) });
    await q.enqueue(save('a'));
    await q.enqueue(save('a'));
    expect(q.items()).toHaveLength(1);
    expect(parseFoodQueue('not json')).toEqual([]);
    expect(parseFoodQueue(JSON.stringify([{ opId: 'x' }, save('ok')])).map((o) => o.opId)).toEqual(['ok']);
  });
});
