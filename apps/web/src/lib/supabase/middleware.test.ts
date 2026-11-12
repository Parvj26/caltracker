import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The proxy runs before every page. It refreshes the session and checks it with getClaims (verified locally against
// the project's public signing key) instead of a getUser network call to Supabase Auth.
const getClaims = vi.fn();
const getUser = vi.fn();
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getClaims, getUser } }) }));

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
});
