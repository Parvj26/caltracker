import { beforeEach, describe, expect, it, vi } from 'vitest';

// requireCoach runs on every coach page. It must read the signed-in user from the session's verified token
// (getClaims: checked locally against the project's public signing key) and not ask Supabase Auth over the network
// (getUser) each time.
const getClaims = vi.fn();
const getUser = vi.fn();
const rows: Record<string, unknown> = {};
function query(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(ok),
  };
  return builder;
}
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve({ auth: { getClaims, getUser }, from: query }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
// cache() needs a React server request; outside one, call straight through.
vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }));

import { requireCoach } from './auth';

beforeEach(() => {
  getClaims.mockReset();
  getUser.mockReset();
  rows.workspace_members = [{ workspace_id: 'ws1', workspaces: { name: 'Gym' } }];
  rows.profiles = { first_name: 'Ana', last_name: 'Coach', units: 'kg', bio: '', avatar_path: null, updated_at: null };
});

describe('requireCoach', () => {
  it('reads the user from the verified token, without a getUser network call', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u1', email: 'ana@example.com' } }, error: null });
    const coach = await requireCoach();
    expect(coach).toMatchObject({ userId: 'u1', email: 'ana@example.com', workspaceId: 'ws1', workspaceName: 'Gym', firstName: 'Ana', units: 'kg' });
    expect(getUser).not.toHaveBeenCalled();
  });
  it('sends a visitor without a valid session to sign in', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('invalid JWT') });
    await expect(requireCoach()).rejects.toThrow('redirect /sign-in');
  });
  it('sends a signed-in non-coach to /not-a-coach', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'u2', email: 'c@example.com' } }, error: null });
    rows.workspace_members = [];
    await expect(requireCoach()).rejects.toThrow('redirect /not-a-coach');
  });
});
