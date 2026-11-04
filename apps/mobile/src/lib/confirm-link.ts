import type { SupabaseClient } from '@supabase/supabase-js';

export type ConfirmResult = { ok: true } | { ok: false; message: string };

export const LINK_FAILED = "This link didn't work. Sign in instead.";

/** Completes email confirmation from caltracker://auth/confirmed?code=... (PKCE only). Never throws. */
export async function completeConfirmation(
  client: Pick<SupabaseClient, 'auth'>,
  url: string,
): Promise<ConfirmResult> {
  let code: string | null;
  try {
    code = new URL(url).searchParams.get('code');
  } catch {
    return { ok: false, message: LINK_FAILED };
  }
  if (!code) return { ok: false, message: LINK_FAILED };
  try {
    const { error } = await client.auth.exchangeCodeForSession(code);
    return error ? { ok: false, message: LINK_FAILED } : { ok: true };
  } catch {
    return { ok: false, message: LINK_FAILED };
  }
}
