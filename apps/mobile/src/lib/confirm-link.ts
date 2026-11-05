import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

export type ConfirmResult = { ok: true } | { ok: false; message: string };

export const LINK_FAILED = "This link didn't work. Sign in instead.";

/** Reads and re-writes the PKCE code verifier that sign-up stored on this device. */
export type VerifierStore = {
  read: () => Promise<string | null>;
  restore: (verifier: string) => Promise<void>;
};

type Options = {
  verifier?: VerifierStore;
  /** Waits between attempts; injectable so tests run instantly. */
  wait?: (ms: number) => Promise<void>;
};

/** Pause before each retry. Two retries cover a connection iOS dropped while the app was in the background. */
const RETRY_DELAYS_MS = [500, 1500];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The `code` from caltracker://auth/confirmed?code=... (PKCE only). Prefers the router's route param,
 * which is set on warm and cold opens alike, and falls back to the linking URL's query string.
 * Fragments (#access_token=...) are never read, so a link can't inject a session.
 */
export function codeFromLink(param: string | string[] | undefined, url: string | null): string | null {
  if (typeof param === 'string' && param) return param;
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('code') || null;
  } catch {
    return null;
  }
}

/** A failure where the request may never have reached the server (dropped connection, offline). */
function isNetworkFailure(e: unknown): boolean {
  return isAuthRetryableFetchError(e) || e instanceof TypeError;
}

/**
 * Exchanges the confirmation code for a session. Never throws.
 *
 * supabase-js deletes the stored verifier after every attempt, even one that failed before reaching the
 * server. When iOS resumes the app from the background, the first request can fail on a stale connection,
 * so on a network failure we put the verifier back and try again. Auth errors (bad or used code) are final.
 */
export async function completeConfirmation(
  client: Pick<SupabaseClient, 'auth'>,
  code: string | null,
  { verifier, wait = sleep }: Options = {},
): Promise<ConfirmResult> {
  if (!code) return { ok: false, message: LINK_FAILED };
  let saved: string | null = null;
  try {
    saved = (await verifier?.read()) ?? null;
  } catch {
    // Unreadable: still try once; supabase-js reports a missing verifier as an auth error.
  }
  for (let attempt = 0; ; attempt++) {
    let failure: unknown;
    try {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) return { ok: true };
      failure = error;
    } catch (e) {
      failure = e;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (!isNetworkFailure(failure) || delay === undefined || !saved || !verifier) {
      return { ok: false, message: LINK_FAILED };
    }
    try {
      await wait(delay);
      await verifier.restore(saved);
    } catch {
      return { ok: false, message: LINK_FAILED };
    }
  }
}

/**
 * Wraps an exchange so each code is exchanged at most once. A code is single-use and the first attempt deletes
 * the stored verifier, so a second exchange (the screen's effect re-running, or the screen remounting) would fail
 * and show an error even though the first one signed the user in. A repeat call gets the first call's promise.
 */
export function oncePerCode<R>(confirm: (code: string) => Promise<R>): (code: string) => Promise<R> {
  const started = new Map<string, Promise<R>>();
  return (code) => {
    let attempt = started.get(code);
    if (!attempt) {
      attempt = confirm(code);
      started.set(code, attempt);
    }
    return attempt;
  };
}
