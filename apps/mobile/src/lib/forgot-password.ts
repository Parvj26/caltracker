import type { ErrorCode } from '@caltracker/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isNetworkFailure } from './network-failure';

// "Forgot password?" from the sign-in screen. The email's link opens the website (/auth/confirm -> /set-password);
// the client sets a new password there, then signs in on the app.

/** Shown after every send, whether or not the email has an account (the web shows the same words). */
export const RESET_SENT = "If that email has an account, we've sent a link. It can take a minute to arrive.";

export type ResetResult = { ok: true } | { ok: false; code: ErrorCode };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Our own code for a failed reset request. Never the raw auth message. */
export function resetErrorCode(err: unknown): ErrorCode {
  if (isNetworkFailure(err)) return 'network_offline';
  const e = (err ?? {}) as { status?: unknown; code?: unknown };
  if (e.status === 429) return 'reset_rate_limited';
  if (e.code === 'email_address_invalid' || e.code === 'validation_failed') return 'reset_email_invalid';
  return 'reset_send_failed';
}

/**
 * Asks Supabase to send the "Reset password" email. Never throws.
 * No redirectTo: the recovery template builds its link from the project's Site URL (the website), the same as the
 * web's forgot-password form, so the link always matches the environment the app talks to.
 */
export async function requestPasswordReset(client: Pick<SupabaseClient, 'auth'>, rawEmail: string): Promise<ResetResult> {
  const email = rawEmail.trim();
  if (!EMAIL.test(email)) return { ok: false, code: 'reset_email_invalid' };
  try {
    const { error } = await client.auth.resetPasswordForEmail(email);
    return error ? { ok: false, code: resetErrorCode(error) } : { ok: true };
  } catch (e) {
    return { ok: false, code: resetErrorCode(e) };
  }
}

/** The Forgot password link, carrying the email already typed on sign-in. */
export function forgotPasswordHref(email: string): { pathname: '/forgot-password'; params?: { email: string } } {
  const clean = email.trim();
  return clean ? { pathname: '/forgot-password', params: { email: clean } } : { pathname: '/forgot-password' };
}
