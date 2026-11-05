import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { joinInvite, joinMessage, loadInvite, type JoinFailure } from './join-invite';

const token = 'A'.repeat(43);
const input = { token, password: 'password1', firstName: 'Sam', lastName: 'Lee' };

function fakeClient(opts: {
  preview?: { data: unknown; error: unknown } | Error;
  invoke?: { data: unknown; error: unknown } | Error;
  signIn?: { error: unknown };
}) {
  const settle = <T>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  const rpc = vi.fn(() => settle(opts.preview ?? { data: [], error: null }));
  const invoke = vi.fn(() => settle(opts.invoke ?? { data: null, error: null }));
  const signInWithPassword = vi.fn(() => Promise.resolve(opts.signIn ?? { error: null }));
  return {
    client: { rpc, functions: { invoke }, auth: { signInWithPassword } } as never,
    rpc,
    invoke,
    signInWithPassword,
  };
}

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('loadInvite', () => {
  it('returns the coach-entered details of a valid invite', async () => {
    const { client, rpc } = fakeClient({
      preview: {
        data: [{ status: 'valid', workspace_name: 'Fit Co', email: 'sam@x.com', first_name: 'Sam', last_name: 'Lee' }],
        error: null,
      },
    });
    expect(await loadInvite(client, token)).toEqual({
      status: 'valid',
      workspaceName: 'Fit Co',
      email: 'sam@x.com',
      firstName: 'Sam',
      lastName: 'Lee',
    });
    expect(rpc).toHaveBeenCalledWith('get_invite_preview', { token });
  });

  it('maps accepted to used, and passes expired and not_found through', async () => {
    for (const [status, expected] of [
      ['accepted', 'used'],
      ['expired', 'expired'],
      ['not_found', 'not_found'],
    ] as const) {
      const { client } = fakeClient({ preview: { data: [{ status }], error: null } });
      expect(await loadInvite(client, token)).toEqual({ status: expected });
    }
  });

  it('never calls the database for a malformed token', async () => {
    const { client, rpc } = fakeClient({});
    expect(await loadInvite(client, 'short')).toEqual({ status: 'not_found' });
    expect(await loadInvite(client, undefined)).toEqual({ status: 'not_found' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports offline when the request fails', async () => {
    expect(await loadInvite(fakeClient({ preview: new TypeError('Network request failed') }).client, token)).toEqual({
      status: 'offline',
    });
    expect(await loadInvite(fakeClient({ preview: { data: null, error: { message: 'x' } } }).client, token)).toEqual({
      status: 'offline',
    });
  });
});

describe('joinInvite', () => {
  it('joins, then signs in with the invited email and the chosen password', async () => {
    const { client, invoke, signInWithPassword } = fakeClient({ invoke: { data: { ok: true, email: 'sam@x.com' }, error: null } });
    expect(await joinInvite(client, input)).toEqual({ ok: true, email: 'sam@x.com' });
    expect(invoke).toHaveBeenCalledWith('accept-invite', { body: input });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'sam@x.com', password: 'password1' });
  });

  it('passes a refusal reason through without signing in', async () => {
    const { client, signInWithPassword } = fakeClient({ invoke: { data: { ok: false, reason: 'account_exists' }, error: null } });
    expect(await joinInvite(client, input)).toEqual({ ok: false, reason: 'account_exists' });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('reads the reason from a 400 response', async () => {
    const { client } = fakeClient({ invoke: { data: null, error: httpError(400, { ok: false, reason: 'invalid_request' }) } });
    expect(await joinInvite(client, input)).toEqual({ ok: false, reason: 'invalid_request' });
  });

  it('treats a server error or an unknown body as a retryable failure', async () => {
    expect(await joinInvite(fakeClient({ invoke: { data: null, error: httpError(500, { error: 'x' }) } }).client, input)).toEqual({
      ok: false,
      reason: 'server',
    });
    expect(await joinInvite(fakeClient({ invoke: { data: { what: 1 }, error: null } }).client, input)).toEqual({
      ok: false,
      reason: 'server',
    });
  });

  it('reports offline when the request never got through', async () => {
    const fetchFailed = new FunctionsFetchError(new TypeError('Network request failed'));
    expect(await joinInvite(fakeClient({ invoke: { data: null, error: fetchFailed } }).client, input)).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(await joinInvite(fakeClient({ invoke: new TypeError('Network request failed') }).client, input)).toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('joined but sign-in failed: sends them to sign in with their new password', async () => {
    const { client } = fakeClient({
      invoke: { data: { ok: true, email: 'sam@x.com' }, error: null },
      signIn: { error: { message: 'network' } },
    });
    expect(await joinInvite(client, input)).toEqual({ ok: false, reason: 'joined_sign_in_failed', email: 'sam@x.com' });
  });
});

describe('joinMessage', () => {
  it('has plain-language copy for every failure', () => {
    const reasons: JoinFailure['reason'][] = [
      'not_found',
      'expired',
      'used',
      'account_exists',
      'coach_account',
      'other_coach',
      'weak_password',
      'invalid_request',
      'offline',
      'server',
      'joined_sign_in_failed',
    ];
    for (const r of reasons) expect(joinMessage(r, 'Fit Co').length).toBeGreaterThan(10);
    expect(joinMessage('account_exists', 'Fit Co')).toBe('You already have an account. Sign in to join Fit Co.');
    expect(joinMessage('expired', 'Fit Co')).toBe('This invite has expired. Ask your coach to send a new one.');
    expect(joinMessage('offline', 'Fit Co')).toBe('No connection. Check your internet and try again.');
  });
});
