import { buildServerErrorEvent } from '@caltracker/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '0b6a8f7e-3c2d-4e1f-9a8b-7c6d5e4f3a2b';
const after = vi.fn<(task: () => Promise<void>) => void>();
const headerGet = vi.fn<(name: string) => string | null>();
const getUser = vi.fn();

vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => after(task) }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve({ get: (name: string) => headerGet(name) }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ auth: { getUser } }) }));

const { reportRequestError, reportServerError, scrubRoutePath, send, userIdFromCookieHeader } = await import('./server');

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (sub: string) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub, email: 'luis@example.com' }))}.sig`;
type FetchMock = { mock: { calls: Parameters<typeof fetch>[] } };
const rawBody = (f: FetchMock) => f.mock.calls[0]![1]?.body as string;
const sentBody = (f: FetchMock) => JSON.parse(rawBody(f)) as Record<string, unknown>;
const event = buildServerErrorEvent({ code: 'assign_save_failed', where: 'action:assign', distinctId: USER });

beforeEach(() => {
  after.mockReset();
  headerGet.mockReset();
  getUser.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('send', () => {
  it('never calls fetch without a key', async () => {
    vi.stubEnv('POSTHOG_SERVER_KEY', '');
    const fetchImpl = vi.fn<typeof fetch>();
    await send(event, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves when fetch rejects or throws', async () => {
    await expect(send(event, { key: 'phc_x', fetchImpl: () => Promise.reject(new Error('down')) })).resolves.toBeUndefined();
    await expect(
      send(event, {
        key: 'phc_x',
        fetchImpl: () => {
          throw new Error('sync');
        },
      }),
    ).resolves.toBeUndefined();
    await expect(send(event, { key: 'phc_x', host: 'not a url' })).resolves.toBeUndefined();
  });

  it('posts only the builder fields plus the key, to the capture endpoint with a timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    await send(event, { key: 'phc_x', host: 'https://eu.i.posthog.com/', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://eu.i.posthog.com/i/v0/e/');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({ api_key: 'phc_x', ...event });
  });

  it('reads key and host from the environment, defaulting to the US host', async () => {
    vi.stubEnv('POSTHOG_SERVER_KEY', 'phc_env');
    vi.stubEnv('POSTHOG_HOST', '');
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    await send(event, { fetchImpl });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://us.i.posthog.com/i/v0/e/');
    expect(sentBody(fetchImpl).api_key).toBe('phc_env');
  });
});

describe('reportServerError', () => {
  it('does nothing without a key', () => {
    vi.stubEnv('POSTHOG_SERVER_KEY', '');
    reportServerError({ code: 'assign_save_failed', where: 'action:assign' });
    expect(after).not.toHaveBeenCalled();
  });

  it('schedules the send with after(), with user id and session header, no message', async () => {
    vi.stubEnv('POSTHOG_SERVER_KEY', 'phc_x');
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetchMock);
    getUser.mockResolvedValue({ data: { user: { id: USER, email: 'luis@example.com' } } });
    headerGet.mockImplementation((name) => (name === 'x-posthog-session-id' ? 'sess-123' : null));

    reportServerError({ error: new Error('luis@example.com'), code: 'assign_save_failed', where: 'action:assign.assignProgram' });
    expect(after).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    await after.mock.calls[0]![0]();

    const body = rawBody(fetchMock);
    expect(body).not.toContain('luis');
    expect(JSON.parse(body)).toEqual({
      api_key: 'phc_x',
      event: '$exception',
      distinct_id: USER,
      properties: {
        $exception_list: [{ type: 'Error', value: 'assign_save_failed' }],
        code: 'assign_save_failed',
        where: 'action:assign.assignProgram',
        $session_id: 'sess-123',
      },
    });
    vi.unstubAllGlobals();
  });

  it('never throws when after() throws or the user lookup fails', async () => {
    vi.stubEnv('POSTHOG_SERVER_KEY', 'phc_x');
    after.mockImplementationOnce(() => {
      throw new Error('outside request scope');
    });
    expect(() => reportServerError({ code: 'x_failed', where: 'action:a' })).not.toThrow();

    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new Error('down')));
    vi.stubGlobal('fetch', fetchMock);
    getUser.mockRejectedValue(new Error('auth down'));
    reportServerError({ code: 'x_failed', where: 'action:a' });
    await expect(after.mock.calls.at(-1)![0]()).resolves.toBeUndefined();
    expect(sentBody(fetchMock).distinct_id).toBe('server');
    vi.unstubAllGlobals();
  });
});

describe('userIdFromCookieHeader', () => {
  const session = (sub: string) => JSON.stringify({ access_token: jwt(sub), user: { email: 'luis@example.com' } });

  it('reads sub from a base64 cookie, whole or chunked', () => {
    const value = `base64-${b64url(session(USER))}`;
    expect(userIdFromCookieHeader(`a=1; sb-abc-auth-token=${value}`)).toBe(USER);
    const chunked = `sb-abc-auth-token.0=${value.slice(0, 50)}; sb-abc-auth-token.1=${value.slice(50)}`;
    expect(userIdFromCookieHeader(chunked)).toBe(USER);
  });

  it('reads a url-encoded JSON cookie', () => {
    expect(userIdFromCookieHeader(`sb-abc-auth-token=${encodeURIComponent(session(USER))}`)).toBe(USER);
  });

  it('returns null for missing or garbage cookies', () => {
    for (const h of [null, '', 'a=1', 'sb-abc-auth-token=base64-!!!', 'sb-abc-auth-token=%7B%7D', 'sb-abc-auth-token=%E0%A4%A']) {
      expect(userIdFromCookieHeader(h)).toBeNull();
    }
  });
});

describe('scrubRoutePath', () => {
  it('drops route groups, parallel slots and the page suffix', () => {
    expect(scrubRoutePath('/(coach)/clients/[clientId]/training/page')).toBe('clients/[clientId]/training');
    expect(scrubRoutePath('/(coach)/page')).toBe('/');
    expect(scrubRoutePath('/(coach)/@modal/x/page')).toBe('x');
    expect(scrubRoutePath('/a b/page?q=luis')).toBe('a_b');
  });
});

describe('reportRequestError (onRequestError)', () => {
  const request = (headers: Record<string, string>) => ({ headers });

  it('sends a server_error for a thrown action error, with nothing from the error', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response('{}')));
    const err = Object.assign(new Error('duplicate key luis@example.com'), { digest: '123', body: { name: 'Luis' } });
    await reportRequestError(
      err,
      request({ cookie: `sb-x-auth-token=base64-${b64url(JSON.stringify({ access_token: jwt(USER) }))}`, 'x-posthog-session-id': 'sess-1' }),
      { routeType: 'action', routePath: '/(coach)/clients/[clientId]/training/page' },
      { key: 'phc_x', fetchImpl },
    );
    const body = rawBody(fetchImpl);
    expect(body).not.toMatch(/luis|Luis|duplicate|digest/);
    expect(JSON.parse(body)).toEqual({
      api_key: 'phc_x',
      event: '$exception',
      distinct_id: USER,
      properties: {
        $exception_list: [{ type: 'Error', value: 'server_error' }],
        code: 'server_error',
        where: 'action:clients/[clientId]/training',
        $session_id: 'sess-1',
      },
    });
  });

  it('ignores render errors and never throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('down')));
    await reportRequestError(new Error('x'), request({}), { routeType: 'render', routePath: '/page' }, { key: 'phc_x', fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      reportRequestError(new Error('x'), request({}), { routeType: 'action', routePath: '/page' }, { key: 'phc_x', fetchImpl }),
    ).resolves.toBeUndefined();
    expect(sentBody(fetchImpl).distinct_id).toBe('server');
  });
});
