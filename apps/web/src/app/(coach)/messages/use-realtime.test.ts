import { describe, expect, it, vi } from 'vitest';
import { subscribeChanges } from './use-realtime';

/** A stand-in for the shared browser client that, like realtime-js, hands back a still-open channel by topic. */
function fakeClient() {
  const open = new Map<string, { topic: string; subscribed: number }>();
  const removed: string[] = [];
  const calls: string[] = [];
  return {
    open,
    removed,
    calls,
    client: {
      realtime: {
        setAuth: () => {
          calls.push('setAuth');
          return Promise.resolve();
        },
      },
      channel(topic: string) {
        const ch = open.get(topic) ?? { topic, subscribed: 0 };
        open.set(topic, ch);
        const api = {
          topic,
          on: () => api,
          subscribe: () => {
            calls.push('subscribe');
            ch.subscribed += 1;
            return api;
          },
        };
        return api;
      },
      removeChannel(ch: { topic: string }) {
        removed.push(ch.topic);
        return Promise.resolve('ok');
      },
    },
  };
}

const specs = [{ table: 'messages' as const, filter: 'conversation_id=eq.1' }];
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('subscribeChanges', () => {
  it('loads the signed-in token into Realtime before joining, so the first join is not checked as anon', async () => {
    const f = fakeClient();
    subscribeChanges(f.client as never, 'thread-1', specs, { onChange: vi.fn() });
    await settle();
    expect(f.calls).toEqual(['setAuth', 'subscribe']);
  });

  it('uses a different topic on every join, so a remount never reuses a channel that is still leaving', async () => {
    const f = fakeClient();
    const leaveFirst = subscribeChanges(f.client as never, 'thread-1', specs, { onChange: vi.fn() });
    // StrictMode: leave and join again straight away.
    leaveFirst();
    subscribeChanges(f.client as never, 'thread-1', specs, { onChange: vi.fn() });
    await settle();
    const topics = [...f.open.keys()];
    expect(topics).toHaveLength(2);
    expect(new Set(topics).size).toBe(2);
    expect(topics.every((t) => t.startsWith('thread-1:'))).toBe(true);
    // The channel left before its join never subscribes; the second subscribes once. Only the first was removed.
    expect(f.open.get(topics[0]!)?.subscribed).toBe(0);
    expect(f.open.get(topics[1]!)?.subscribed).toBe(1);
    expect(f.removed).toEqual([topics[0]]);
  });
});
