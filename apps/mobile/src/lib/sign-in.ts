// Sign in on the phone (approved Patterns board, 2026-11-19): the fields are checked here first, each error shown
// under its field, and a sign-in that hangs gives up with a clear message instead of spinning. Pure apart from the
// call it is given, so it is unit tested.
import type { ErrorCode } from '@caltracker/shared';
import { isNetworkFailure } from './network-failure';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gives up waiting for the server after this long. */
export const SIGN_IN_TIMEOUT_MS = 15_000;

export type SignInFieldErrors = { email?: ErrorCode; password?: ErrorCode };

/** What is wrong with each field before anything is sent (empty means nothing). */
export function signInFieldErrors(email: string, password: string): SignInFieldErrors {
  const out: SignInFieldErrors = {};
  const e = email.trim();
  if (e === '') out.email = 'sign_in_email_missing';
  else if (!EMAIL.test(e)) out.email = 'sign_in_email_invalid';
  if (password === '') out.password = 'sign_in_password_missing';
  return out;
}

/** One field's error once it was left (blur) or a submit was tried. */
export function emailFieldError(email: string): ErrorCode | undefined {
  return signInFieldErrors(email, 'x').email;
}

type AuthError = { code?: string; status?: number } | null;
export type SignInCall = (email: string, password: string) => Promise<{ error: AuthError }>;

/** Signs in, or says why not: never the raw auth message, the same words for an unknown email and a wrong password. */
export async function signIn(call: SignInCall, email: string, password: string, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<ErrorCode | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([call(email.trim(), password), timeout]);
    if (result === 'timeout') return 'sign_in_timeout';
    const err = result.error;
    if (!err) return null;
    if (isNetworkFailure(err)) return 'network_offline';
    return err.code === 'invalid_credentials' || err.status === 400 ? 'sign_in_failed' : 'server_error';
  } catch (e) {
    return isNetworkFailure(e) ? 'network_offline' : 'server_error';
  } finally {
    clearTimeout(timer);
  }
}
