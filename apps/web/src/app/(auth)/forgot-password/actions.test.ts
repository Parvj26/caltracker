import { beforeEach, describe, expect, it, vi } from 'vitest';

const afterCallbacks: (() => Promise<void> | void)[] = [];
vi.mock('next/server', () => ({ after: (cb: () => Promise<void> | void) => afterCallbacks.push(cb) }));

let release: () => void = () => {};
const resetPasswordForEmail = vi.fn(() => new Promise<{ error: null }>((resolve) => (release = () => resolve({ error: null }))));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve({ auth: { resetPasswordForEmail } }),
}));

import { requestPasswordReset } from './actions';

const form = (email: string) => {
  const f = new FormData();
  f.set('email', email);
  return f;
};

describe('requestPasswordReset', () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    resetPasswordForEmail.mockClear();
  });

  it('answers without waiting for the email request, so timing does not reveal whether an account exists', async () => {
    // The mocked reset call never finishes; the action must still return.
    const result = await requestPasswordReset({ done: false }, form('someone@example.com'));
    expect(result).toEqual({ done: true });
    expect(resetPasswordForEmail).not.toHaveBeenCalled(); // deferred, not run in the response path
    expect(afterCallbacks).toHaveLength(1);

    const running = afterCallbacks[0]!();
    expect(resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com');
    release();
    await running;
  });

  it('gives an identical result for any address, including an empty one', async () => {
    const known = await requestPasswordReset({ done: false }, form('known@example.com'));
    const unknown = await requestPasswordReset({ done: false }, form('nobody@example.com'));
    const empty = await requestPasswordReset({ done: false }, form('  '));
    expect(known).toEqual(unknown);
    expect(known).toEqual(empty);
    expect(afterCallbacks).toHaveLength(2); // nothing queued for the empty address
  });
});
