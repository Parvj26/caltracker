import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The proxy runs before every page. It refreshes the session and checks it with getClaims (verified locally against
// the project's public signing key) instead of a getUser network call to Supabase Auth.
const getClaims = vi.fn();
const getUser = vi.fn();
type CookieOpts = { cookies: { setAll: (c: Array<{ name: string; value: string; options: Record<string, unknown> }>) => void } };
let opts: CookieOpts | null = null;
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, o: CookieOpts) => {
    opts = o;
    return { auth: { getClaims, getUser } };
  },
}));
/** getClaims refreshing an expired session: the library hands the new tokens to setAll, as @supabase/ssr does. */
const refreshThen = (result: unknown) => () => {
  opts!.cookies.setAll([{ name: 'sb-test-auth-token', value: 'fresh', options: { path: '/', httpOnly: true } }]);
  return Promise.resolve(result);
};

import { updateSession } from './middleware';

const req = (path: string) => new NextRequest(new URL(path, 'https://caltracker.test'));

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockReset();
});

describe('updateSession', () => {
  it('lets a signed-in coach through without a getUser call', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1' } }, error: null });
    const res = await updateSession(req('/workouts'));
    expect(res.headers.get('location')).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
  it('sends a visitor without a valid session to /sign-in', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('invalid JWT') });
    const res = await updateSession(req('/workouts?x=1'));
    expect(res.headers.get('location')).toBe('https://caltracker.test/sign-in');
  });
  it('leaves public pages open', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req('/invite/abc'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('passes refreshed session cookies on to the page', async () => {
    getClaims.mockImplementation(refreshThen({ data: { claims: { sub: 'u1' } }, error: null }));
    const res = await updateSession(req('/workouts'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get('sb-test-auth-token')?.value).toBe('fresh');
  });
  it('keeps the refreshed cookies on the sign-in redirect too', async () => {
    getClaims.mockImplementation(refreshThen({ data: null, error: new Error('refresh token revoked') }));
    const res = await updateSession(req('/workouts'));
    expect(res.headers.get('location')).toBe('https://caltracker.test/sign-in');
    expect(res.cookies.get('sb-test-auth-token')?.value).toBe('fresh');
  });
});
