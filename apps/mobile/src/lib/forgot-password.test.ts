import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { isErrorCode } from '@caltracker/shared';
import { describe, expect, it, vi } from 'vitest';
import { RESET_SENT, forgotPasswordHref, requestPasswordReset, resetErrorCode } from './forgot-password';

function fakeClient(result: { error: unknown } | Error) {
  const resetPasswordForEmail = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve({ data: {}, ...result })));
  return { client: { auth: { resetPasswordForEmail } } as never, resetPasswordForEmail };
}

describe('requestPasswordReset', () => {
  it('sends the trimmed email and reports success', async () => {
    const { client, resetPasswordForEmail } = fakeClient({ error: null });
    expect(await requestPasswordReset(client, '  sam@x.com ')).toEqual({ ok: true });
    // No redirectTo: the recovery email template builds the link from the project's Site URL (the website's
    // /auth/confirm -> /set-password), exactly like the web's forgot-password form.
    expect(resetPasswordForEmail).toHaveBeenCalledWith('sam@x.com');
  });

  it('refuses an empty or malformed email without calling the server', async () => {
    const { client, resetPasswordForEmail } = fakeClient({ error: null });
    expect(await requestPasswordReset(client, '   ')).toEqual({ ok: false, code: 'reset_email_invalid' });
    expect(await requestPasswordReset(client, 'not-an-email')).toEqual({ ok: false, code: 'reset_email_invalid' });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('shows the friendly rate-limit message on 429', async () => {
    const { client } = fakeClient({ error: new AuthApiError('For security purposes, you can only request this after 42 seconds.', 429, 'over_email_send_rate_limit') });
    expect(await requestPasswordReset(client, 'sam@x.com')).toEqual({ ok: false, code: 'reset_rate_limited' });
  });

  it('says offline when the request never reached the server, returned or thrown', async () => {
    const returned = fakeClient({ error: new AuthRetryableFetchError('Network request failed', 0) });
    expect(await requestPasswordReset(returned.client, 'sam@x.com')).toEqual({ ok: false, code: 'network_offline' });
    const thrown = fakeClient(new TypeError('Network request failed'));
    expect(await requestPasswordReset(thrown.client, 'sam@x.com')).toEqual({ ok: false, code: 'network_offline' });
  });

  it('maps a server-side email rejection to the email message, anything else to a generic send failure', async () => {
    const invalid = fakeClient({ error: new AuthApiError('Unable to validate email address: invalid format', 400, 'email_address_invalid') });
    expect(await requestPasswordReset(invalid.client, 'sam@x.com')).toEqual({ ok: false, code: 'reset_email_invalid' });
    const broken = fakeClient({ error: new AuthApiError('Error sending recovery email', 500, 'unexpected_failure') });
    expect(await requestPasswordReset(broken.client, 'sam@x.com')).toEqual({ ok: false, code: 'reset_send_failed' });
  });
});

describe('resetErrorCode', () => {
  it('only ever returns catalogue codes', () => {
    for (const err of [{ status: 429 }, { status: 400, code: 'validation_failed' }, { status: 503 }, new TypeError('Failed to fetch'), null]) {
      expect(isErrorCode(resetErrorCode(err))).toBe(true);
    }
  });
});

describe('RESET_SENT', () => {
  it('never says whether the account exists', () => {
    expect(RESET_SENT).toMatch(/^If that email has an account, we've sent a link/);
  });
});

describe('forgotPasswordHref', () => {
  it('carries the email typed on sign-in', () => {
    expect(forgotPasswordHref(' sam@x.com ')).toEqual({ pathname: '/forgot-password', params: { email: 'sam@x.com' } });
  });
  it('has no params when nothing was typed', () => {
    expect(forgotPasswordHref('  ')).toEqual({ pathname: '/forgot-password' });
  });
});
