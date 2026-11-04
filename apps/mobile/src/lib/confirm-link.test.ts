import { describe, expect, it, vi } from 'vitest';
import { LINK_FAILED, completeConfirmation } from './confirm-link';

function fakeClient(result: { error: Error | null } | 'throw') {
  const exchangeCodeForSession = vi.fn(() =>
    result === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(result),
  );
  return { client: { auth: { exchangeCodeForSession } } as never, exchangeCodeForSession };
}

describe('completeConfirmation', () => {
  it('exchanges the code query param', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: null });
    expect(await completeConfirmation(client, 'caltracker://auth/confirmed?code=abc123')).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
  });

  it('never injects tokens from the URL fragment', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: null });
    const r = await completeConfirmation(client, 'caltracker://auth/confirmed#access_token=a&refresh_token=b');
    expect(r).toEqual({ ok: false, message: LINK_FAILED });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('fails gracefully on a malformed URL', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: null });
    expect(await completeConfirmation(client, 'not a url')).toEqual({ ok: false, message: LINK_FAILED });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('fails gracefully when the exchange errors or throws', async () => {
    expect((await completeConfirmation(fakeClient({ error: new Error('bad') }).client, 'caltracker://auth/confirmed?code=x')).ok).toBe(false);
    expect((await completeConfirmation(fakeClient('throw').client, 'caltracker://auth/confirmed?code=x')).ok).toBe(false);
  });
});
