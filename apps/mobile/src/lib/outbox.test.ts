import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from './log-fixtures';
import { RETRY_BACKOFF_MS } from './log-sync';
import { OUTBOX_BACKOFF_MS, OutboxSendError, createOutbox, outboxKey, type OutboxEntry } from './outbox';

const entry = (id: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  clientMsgId: id,
  conversationId: 'conv-1',
  body: `hello ${id}`,
  createdAt: '2026-11-05T09:00:00.000Z',
  photos: [],
  state: 'sending',
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('outbox', () => {
  it('uses the same backoff as the workout log sync', () => {
    expect(OUTBOX_BACKOFF_MS).toEqual(RETRY_BACKOFF_MS);
  });

  it('keeps a queued message on the phone and sends it', async () => {
    const storage = memoryStorage();
    const send = vi.fn().mockResolvedValue(undefined);
    const box = createOutbox({ storage, userId: 'u1', send });
    await box.enqueue(entry('a'));
    await box.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(box.items()).toEqual([]);
    expect(JSON.parse(storage.map.get(outboxKey('u1')) ?? '[]')).toEqual([]);
  });

  it('survives a restart: a message written offline is still there, still "sending", and goes out later', async () => {
    const storage = memoryStorage();
    const offline = vi.fn().mockRejectedValue(new OutboxSendError('network', 'offline'));
    const first = createOutbox({ storage, userId: 'u1', send: offline });
    await first.enqueue(entry('a'));
    await first.flush();
    expect(first.items().map((i) => i.state)).toEqual(['sending']);
    first.stop();

    const send = vi.fn().mockResolvedValue(undefined);
    const second = createOutbox({ storage, userId: 'u1', send });
    await second.load();
    expect(second.items().map((i) => i.clientMsgId)).toEqual(['a']);
    await second.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(second.items()).toEqual([]);
  });

  it('retries a network failure with 5 s, 15 s, 60 s, then 300 s', async () => {
    const send = vi.fn().mockRejectedValue(new OutboxSendError('network', 'offline'));
    const box = createOutbox({ storage: memoryStorage(), userId: 'u1', send });
    await box.enqueue(entry('a'));
    await box.flush();
    expect(send).toHaveBeenCalledTimes(1);
    for (const [i, ms] of [5000, 15000, 60000, 300000, 300000].entries()) {
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(send).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(i + 2);
    }
    send.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(300000);
    expect(box.items()).toEqual([]);
    box.stop();
  });

  it('sends a message once even when the app died before it heard back', async () => {
    const storage = memoryStorage();
    // The server stores by (sender, client_msg_id); a repeat changes nothing.
    const server = new Map<string, string>();
    const reachServerButLoseAnswer = vi.fn((e: OutboxEntry) => {
      server.set(e.clientMsgId, e.body);
      return Promise.reject(new OutboxSendError('network', 'answer lost'));
    });
    const before = createOutbox({ storage, userId: 'u1', send: reachServerButLoseAnswer });
    await before.enqueue(entry('a'));
    await before.flush();
    before.stop();

    const after = createOutbox({
      storage,
      userId: 'u1',
      send: (e) => {
        server.set(e.clientMsgId, e.body);
        return Promise.resolve();
      },
    });
    await after.load();
    await after.flush();
    expect(server.size).toBe(1);
    expect(after.items()).toEqual([]);
  });

  it('ignores a second enqueue of the same client_msg_id', async () => {
    const box = createOutbox({ storage: memoryStorage(), userId: 'u1', send: vi.fn().mockRejectedValue(new OutboxSendError('network', 'x')) });
    await box.enqueue(entry('a'));
    await box.enqueue(entry('a', { body: 'again' }));
    expect(box.items()).toHaveLength(1);
    expect(box.items()[0].body).toBe('hello a');
    box.stop();
  });

  it('turns a failed photo upload into "Didn\'t send" and sends again on Retry', async () => {
    const storage = memoryStorage();
    const send = vi.fn().mockRejectedValueOnce(new OutboxSendError('photo', "Couldn't upload the photo."));
    send.mockResolvedValue(undefined);
    const box = createOutbox({ storage, userId: 'u1', send });
    await box.enqueue(entry('a', { photos: [{ id: 'p1', fullUri: 'file:///a.webp', thumbUri: 'file:///a-t.webp', ext: 'webp' }] }));
    await box.flush();
    expect(box.items()[0]).toMatchObject({ state: 'failed', error: "Couldn't upload the photo." });
    // Not retried on its own.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(send).toHaveBeenCalledTimes(1);

    // Still failed after a restart.
    const again = createOutbox({ storage, userId: 'u1', send });
    await again.load();
    expect(again.items()[0].state).toBe('failed');
    await again.retry('a');
    expect(send).toHaveBeenCalledTimes(2);
    expect(again.items()).toEqual([]);
  });

  it('a refused message fails without blocking the ones behind it', async () => {
    const send = vi.fn((e: OutboxEntry) =>
      e.clientMsgId === 'a' ? Promise.reject(new OutboxSendError('refused', 'You can\'t message this coach any more.')) : Promise.resolve(),
    );
    const box = createOutbox({ storage: memoryStorage(), userId: 'u1', send });
    await box.enqueue(entry('a'));
    await box.enqueue(entry('b', { createdAt: '2026-11-05T09:01:00.000Z' }));
    await box.flush();
    expect(box.items().map((i) => [i.clientMsgId, i.state])).toEqual([['a', 'failed']]);
  });

  it('sends in the order they were written and stops at the first network failure', async () => {
    const sent: string[] = [];
    let online = false;
    const send = vi.fn((e: OutboxEntry) => {
      if (!online) return Promise.reject(new OutboxSendError('network', 'offline'));
      sent.push(e.clientMsgId);
      return Promise.resolve();
    });
    const box = createOutbox({ storage: memoryStorage(), userId: 'u1', send });
    await box.enqueue(entry('a'));
    await box.enqueue(entry('b', { createdAt: '2026-11-05T09:01:00.000Z' }));
    await box.flush();
    expect(send).toHaveBeenCalledTimes(1);
    online = true;
    await box.flush();
    expect(sent).toEqual(['a', 'b']);
  });

  it('keeps one user\'s messages apart from another\'s', async () => {
    const storage = memoryStorage();
    const a = createOutbox({ storage, userId: 'u1', send: vi.fn().mockRejectedValue(new OutboxSendError('network', 'x')) });
    await a.enqueue(entry('a'));
    a.stop();
    const b = createOutbox({ storage, userId: 'u2', send: vi.fn() });
    await b.load();
    expect(b.items()).toEqual([]);
  });

  it('survives unreadable stored data', async () => {
    const storage = memoryStorage();
    storage.map.set(outboxKey('u1'), '{not json');
    const box = createOutbox({ storage, userId: 'u1', send: vi.fn() });
    await box.load();
    expect(box.items()).toEqual([]);
  });
});
