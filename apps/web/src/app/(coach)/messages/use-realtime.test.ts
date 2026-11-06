import { describe, expect, it, vi } from 'vitest';
import { subscribeChanges } from './use-realtime';

/** A stand-in for the shared browser client that, like realtime-js, hands back a still-open channel by topic. */
function fakeClient() {
  const open = new Map<string, { topic: string; subscribed: number }>();
  const removed: string[] = [];
  return {
    open,
    removed,
    client: {
      channel(topic: string) {
        const ch = open.get(topic) ?? { topic, subscribed: 0 };
        open.set(topic, ch);
        const api = {
          topic,
          on: () => api,
          subscribe: () => {
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

describe('subscribeChanges', () => {
  it('uses a different topic on every join, so a remount never reuses a channel that is still leaving', () => {
    const f = fakeClient();
    const specs = [{ table: 'messages' as const, filter: 'conversation_id=eq.1' }];
    const leaveFirst = subscribeChanges(f.client as never, 'thread-1', specs, { onChange: vi.fn() });
    // StrictMode: leave and join again straight away.
    leaveFirst();
    subscribeChanges(f.client as never, 'thread-1', specs, { onChange: vi.fn() });
    const topics = [...f.open.keys()];
    expect(topics).toHaveLength(2);
    expect(new Set(topics).size).toBe(2);
    expect(topics.every((t) => t.startsWith('thread-1:'))).toBe(true);
    // Each channel was subscribed exactly once, and only the first was removed.
    expect([...f.open.values()].every((c) => c.subscribed === 1)).toBe(true);
    expect(f.removed).toEqual([topics[0]]);
  });
});
