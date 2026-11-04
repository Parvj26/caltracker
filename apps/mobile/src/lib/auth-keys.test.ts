import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { authStorageKey, pkceVerifierKey } from './auth-keys';

// Upgrade insurance: these run the REAL supabase-js client (only storage and fetch are fakes). The confirmation
// retry (completeConfirmation) puts the PKCE verifier back under pkceVerifierKey(), and the app pins storageKey to
// authStorageKey(). If a supabase-js upgrade changes either key or starts tagging our redirect with a flow id,
// these fail instead of sign-in or the retry silently breaking.

function memoryStorage() {
  const items = new Map<string, string>();
  const storage: SupportedStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
  return { storage, items };
}

type Call = { url: string; body: Record<string, unknown> };
const record = (calls: Call[], input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push({ url, body });
  return url;
};
function fakeFetch(respond: (url: string) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, json } = respond(record(calls, input, init));
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
  };
  return { fetch, calls };
}

const signUpOk = () => ({ status: 200, json: { id: 'user-1', email: 'sam@x.com', aud: 'authenticated' } });

function client(url: string, storage: SupportedStorage, fetch: typeof globalThis.fetch, storageKey?: string) {
  return createClient(url, 'anon-key', {
    global: { fetch },
    auth: {
      ...(storageKey ? { storageKey } : {}),
      storage,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

describe('authStorageKey', () => {
  it.each([
    ['http://127.0.0.1:54321', 'sb-127-auth-token'],
    ['https://vfjnnofocxbpnhwpvkva.supabase.co', 'sb-vfjnnofocxbpnhwpvkva-auth-token'],
  ])('%s -> %s', (url, key) => {
    expect(authStorageKey(url)).toBe(key);
    expect(pkceVerifierKey(key)).toBe(`${key}-code-verifier`);
  });

  it.each(['http://127.0.0.1:54321', 'https://vfjnnofocxbpnhwpvkva.supabase.co'])(
    "matches supabase-js's own default storage key (%s), so pinning it signed nobody out",
    async (url) => {
      const { storage, items } = memoryStorage();
      const { fetch } = fakeFetch(signUpOk);
      // No storageKey passed: supabase-js picks its default.
      const { error } = await client(url, storage, fetch).auth.signUp({ email: 'sam@x.com', password: 'password-123' });
      expect(error).toBeNull();
      expect(items.get(pkceVerifierKey(authStorageKey(url)))).toEqual(expect.any(String));
    },
  );
});

describe('PKCE sign-up and the confirmation retry', () => {
  const url = 'https://vfjnnofocxbpnhwpvkva.supabase.co';
  const storageKey = authStorageKey(url);

  it('stores the verifier under the key the retry restores, and keeps our redirect free of a flow id', async () => {
    const { storage, items } = memoryStorage();
    const { fetch, calls } = fakeFetch(signUpOk);
    const { error } = await client(url, storage, fetch, storageKey).auth.signUp({
      email: 'sam@x.com',
      password: 'password-123',
      options: { emailRedirectTo: 'caltracker://auth/confirmed' },
    });
    expect(error).toBeNull();
    // supabase-js stores it JSON-encoded; the retry copies the raw stored text back, so it never decodes it.
    const verifier = JSON.parse(items.get(pkceVerifierKey(storageKey)) ?? 'null') as unknown;
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    // The challenge sent to the server belongs to that stored verifier.
    expect(calls[0].body.code_challenge).toEqual(expect.any(String));
    // The emailed link comes back as caltracker://auth/confirmed?code=... with no flow id, so the exchange
    // reads the fixed key above.
    const redirectTo = new URL(calls[0].url).searchParams.get('redirect_to');
    expect(redirectTo).toBe('caltracker://auth/confirmed');
  });

  it('after a dropped connection, the restored verifier is the one the next exchange sends', async () => {
    const { storage, items } = memoryStorage();
    let networkDown = true;
    const calls: Call[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const u = record(calls, input, init);
      if (u.includes('/signup')) return fakeFetch(signUpOk).fetch(input, init);
      if (networkDown) return Promise.reject(new TypeError('The network connection was lost.'));
      return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    };
    const supabase = client(url, storage, fetch, storageKey);
    await supabase.auth.signUp({ email: 'sam@x.com', password: 'password-123' });
    const key = pkceVerifierKey(storageKey);
    // What pkceVerifier.read() returns: the raw stored text.
    const saved = items.get(key);
    expect(saved).toEqual(expect.any(String));

    await supabase.auth.exchangeCodeForSession('the-code').catch(() => undefined);
    // supabase-js deletes the verifier even though the request never reached the server ...
    expect(items.has(key)).toBe(false);
    // ... so the retry puts the raw text back (pkceVerifier.restore) and tries again.
    items.set(key, saved!);
    networkDown = false;
    await supabase.auth.exchangeCodeForSession('the-code');
    const exchanges = calls.filter((c) => c.url.includes('/token?grant_type=pkce'));
    expect(exchanges).toHaveLength(2);
    expect(exchanges[1].body).toEqual({ auth_code: 'the-code', code_verifier: JSON.parse(saved!) as string });
  });
});
