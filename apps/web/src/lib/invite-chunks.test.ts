import { describe, expect, it } from 'vitest';
import { sendInChunks } from './invite-chunks';

const invites = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `c${i}@x.com`, fullName: `C${i}` }));

describe('sendInChunks', () => {
  it('calls sequentially in chunks of 20 and merges results in order', async () => {
    const sizes: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const results = await sendInChunks(invites(45), async (chunk) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      sizes.push(chunk.length);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return chunk.map((c) => ({ email: c.email, status: 'sent' as const }));
    });
    expect(sizes).toEqual([20, 20, 5]);
    expect(maxRunning).toBe(1);
    expect(results.map((r) => r.email)).toEqual(invites(45).map((i) => i.email));
  });

  it('a failed chunk marks only its rows as error and the next chunk still goes out', async () => {
    let call = 0;
    const results = await sendInChunks(invites(45), (chunk) => {
      call++;
      if (call === 2) return Promise.reject(new Error('boom'));
      if (call === 3) return Promise.resolve(null);
      return Promise.resolve(chunk.map((c) => ({ email: c.email, status: 'sent' as const })));
    });
    expect(call).toBe(3);
    expect(results.slice(0, 20).every((r) => r.status === 'sent')).toBe(true);
    expect(results.slice(20).every((r) => r.status === 'error')).toBe(true);
    expect(results).toHaveLength(45);
    expect(results[25]?.message).toBe('Not sent — add this client again');
  });
});
