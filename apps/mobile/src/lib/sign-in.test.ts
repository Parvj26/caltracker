import { describe, expect, it } from 'vitest';
import { emailFieldError, signIn, signInFieldErrors } from './sign-in';

describe('signInFieldErrors', () => {
  it('checks the fields on the phone first', () => {
    expect(signInFieldErrors('', '')).toEqual({ email: 'sign_in_email_missing', password: 'sign_in_password_missing' });
    expect(signInFieldErrors('maya@example', 'x')).toEqual({ email: 'sign_in_email_invalid' });
    expect(signInFieldErrors(' maya@example.com ', 'secret')).toEqual({});
    expect(emailFieldError('maya')).toBe('sign_in_email_invalid');
    expect(emailFieldError('maya@example.com')).toBeUndefined();
  });
});

describe('signIn', () => {
  it('trims the email and returns null when signed in', async () => {
    let seen = '';
    expect(await signIn((e) => ((seen = e), Promise.resolve({ error: null })), ' a@b.co ', 'pw')).toBeNull();
    expect(seen).toBe('a@b.co');
  });
  it('says wrong email or password, offline or server error, never the raw message', async () => {
    expect(await signIn(() => Promise.resolve({ error: { code: 'invalid_credentials', status: 400 } }), 'a@b.co', 'pw')).toBe('sign_in_failed');
    expect(await signIn(() => Promise.resolve({ error: { status: 500, code: 'unexpected' } }), 'a@b.co', 'pw')).toBe('server_error');
    expect(await signIn(() => Promise.reject(new TypeError('Network request failed')), 'a@b.co', 'pw')).toBe('network_offline');
  });
  it('gives up with a clear error when the server takes too long', async () => {
    expect(await signIn(() => new Promise(() => undefined), 'a@b.co', 'pw', undefined, 10)).toBe('sign_in_timeout');
  });
  it('lets a late success go through and tells the screen, so it can clear the timeout message', async () => {
    let finish: (v: { error: null }) => void = () => undefined;
    let told = 0;
    const late = new Promise<{ error: null }>((resolve) => (finish = resolve));
    expect(await signIn(() => late, 'a@b.co', 'pw', () => (told += 1), 10)).toBe('sign_in_timeout');
    finish({ error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toBe(1);
    let fail: (v: { error: { status: number } }) => void = () => undefined;
    const lateFail = new Promise<{ error: { status: number } }>((resolve) => (fail = resolve));
    await signIn(() => lateFail, 'a@b.co', 'pw', () => (told += 1), 10);
    fail({ error: { status: 400 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toBe(1);
  });

});
