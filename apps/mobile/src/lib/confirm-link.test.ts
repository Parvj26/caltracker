import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { LINK_FAILED, codeFromLink, completeConfirmation, type VerifierStore } from './confirm-link';

type Outcome = { error: Error | null } | Error;

/** A client whose exchange returns (or throws, for an Error) each outcome in turn. */
function fakeClient(...outcomes: Outcome[]) {
  let i = 0;
  const exchangeCodeForSession = vi.fn(() => {
    const o = outcomes[Math.min(i++, outcomes.length - 1)];
    return o instanceof Error ? Promise.reject(o) : Promise.resolve(o);
  });
  return { client: { auth: { exchangeCodeForSession } } as never, exchangeCodeForSession };
}

/** Mimics supabase-js: every exchange attempt deletes the stored verifier, success or failure. */
function fakeVerifier(initial: string | null = 'verifier-123') {
  let value = initial;
  const store: VerifierStore = {
    read: vi.fn(() => Promise.resolve(value)),
    restore: vi.fn((v: string) => {
      value = v;
      return Promise.resolve();
    }),
  };
  return { store, consume: () => (value = null), current: () => value };
}

const noWait = () => Promise.resolve();
const networkDown = () => new AuthRetryableFetchError('fetch failed: The network connection was lost.', 0);

describe('codeFromLink', () => {
  it('prefers the route param', () => {
    expect(codeFromLink('from-param', 'caltracker://auth/confirmed?code=from-url')).toBe('from-param');
  });

  it('falls back to the code query param of the linking URL', () => {
    expect(codeFromLink(undefined, 'caltracker://auth/confirmed?code=abc123')).toBe('abc123');
    expect(codeFromLink('', 'caltracker://auth/confirmed?code=abc123')).toBe('abc123');
  });

  it('never takes tokens from the URL fragment', () => {
    expect(codeFromLink(undefined, 'caltracker://auth/confirmed#access_token=a&refresh_token=b')).toBeNull();
  });

  it('returns null for a missing or malformed URL', () => {
    expect(codeFromLink(undefined, null)).toBeNull();
    expect(codeFromLink(undefined, 'not a url')).toBeNull();
  });

  it('ignores a repeated param (array) rather than guessing', () => {
    expect(codeFromLink(['a', 'b'], null)).toBeNull();
  });
});

describe('completeConfirmation', () => {
  it('exchanges the code on the first try', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: null });
    const v = fakeVerifier();
    expect(await completeConfirmation(client, 'abc123', { verifier: v.store, wait: noWait })).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(v.store.restore).not.toHaveBeenCalled();
  });

  it('fails without a code and never calls the server', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: null });
    expect(await completeConfirmation(client, null, { wait: noWait })).toEqual({ ok: false, message: LINK_FAILED });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('restores the verifier and retries after a dropped connection', async () => {
    const v = fakeVerifier();
    const exchangeCodeForSession = vi.fn((): Promise<{ error: Error | null }> => {
      // Like supabase-js: the first attempt needs the verifier and deletes it; the retry needs it back.
      const hadVerifier = v.current() !== null;
      v.consume();
      if (!hadVerifier) return Promise.resolve({ error: new Error('verifier missing') });
      return Promise.resolve({ error: exchangeCodeForSession.mock.calls.length === 1 ? networkDown() : null });
    });
    const client = { auth: { exchangeCodeForSession } } as never;
    const wait = vi.fn(noWait);
    expect(await completeConfirmation(client, 'abc123', { verifier: v.store, wait })).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
    expect(v.store.restore).toHaveBeenCalledWith('verifier-123');
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('retries when the exchange throws a network TypeError', async () => {
    const { client, exchangeCodeForSession } = fakeClient(new TypeError('Network request failed'), { error: null });
    const v = fakeVerifier();
    expect(await completeConfirmation(client, 'abc123', { verifier: v.store, wait: noWait })).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });

  it('does not retry an auth error (invalid or expired code)', async () => {
    const { client, exchangeCodeForSession } = fakeClient({
      error: new AuthApiError('invalid flow state, no valid flow state found', 404, 'flow_state_not_found'),
    });
    const v = fakeVerifier();
    expect(await completeConfirmation(client, 'abc123', { verifier: v.store, wait: noWait })).toEqual({
      ok: false,
      message: LINK_FAILED,
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(v.store.restore).not.toHaveBeenCalled();
  });

  it('does not retry an unexpected non-network throw', async () => {
    const { client, exchangeCodeForSession } = fakeClient(new Error('boom'));
    expect(await completeConfirmation(client, 'abc123', { verifier: fakeVerifier().store, wait: noWait })).toEqual({
      ok: false,
      message: LINK_FAILED,
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('gives up after 2 retries', async () => {
    const { client, exchangeCodeForSession } = fakeClient({ error: networkDown() });
    const wait = vi.fn(noWait);
    expect(await completeConfirmation(client, 'abc123', { verifier: fakeVerifier().store, wait })).toEqual({
      ok: false,
      message: LINK_FAILED,
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('never throws, even when the verifier store fails', async () => {
    const { client } = fakeClient({ error: networkDown() });
    const broken: VerifierStore = {
      read: () => Promise.reject(new Error('keychain')),
      restore: () => Promise.reject(new Error('keychain')),
    };
    expect(await completeConfirmation(client, 'abc123', { verifier: broken, wait: noWait })).toEqual({
      ok: false,
      message: LINK_FAILED,
    });
  });
});
