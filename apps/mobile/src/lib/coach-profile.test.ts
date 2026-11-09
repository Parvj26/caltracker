import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => Promise.resolve(void store.set(k, v)),
    removeItem: (k: string) => Promise.resolve(void store.delete(k)),
  },
}));

import { forgetSignedLinks, joinedAtIn, loadCoachProfile, withVersion, type CoachRecord } from './coach-profile';

const record: CoachRecord = {
  name: 'Mia Coach',
  businessName: 'Fit Co',
  bio: 'Strength coach.',
  avatarPath: 'u1/avatar.webp',
  updatedAt: '2026-11-05T10:00:00.000Z',
};
const sign = vi.fn((path: string) => Promise.resolve(`https://x/${path}?token=t`));

beforeEach(() => {
  store.clear();
  sign.mockClear();
  forgetSignedLinks();
});

describe('withVersion', () => {
  it('adds a cache-busting version to a signed link', () => {
    expect(withVersion('https://x/a?token=t', '2026-11-05T10:00:00.000Z')).toBe(
      `https://x/a?token=t&v=${Date.parse('2026-11-05T10:00:00.000Z')}`,
    );
    expect(withVersion('https://x/a', null)).toBe('https://x/a?v=0');
  });
});

describe('joinedAtIn', () => {
  const rows = [
    { workspace_id: 'w-old', created_at: '2025-01-01T00:00:00.000Z' },
    { workspace_id: 'w-now', created_at: '2026-11-03T10:00:00.000Z' },
  ];
  it("takes the membership row of the coach's workspace", () => expect(joinedAtIn(rows, 'w-now')).toBe('2026-11-03T10:00:00.000Z'));
  it('is null without a matching row or a known workspace', () => {
    expect(joinedAtIn(rows, 'w-other')).toBeNull();
    expect(joinedAtIn(rows, null)).toBeNull();
    expect(joinedAtIn([{ workspace_id: 'w-now', created_at: null }], 'w-now')).toBeNull();
  });
});

describe('loadCoachProfile', () => {
  it('returns fresh data with a signed photo link and saves it', async () => {
    const p = await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    expect(p).toMatchObject({ name: 'Mia Coach', businessName: 'Fit Co', bio: 'Strength coach.' });
    expect(p?.avatarUrl).toContain('u1/avatar-thumb.webp');
    expect(store.size).toBe(1);
  });

  it('returns the saved coach when the fetch fails (offline)', async () => {
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    forgetSignedLinks(); // e.g. the app was restarted: no link to reuse, and signing fails offline
    const p = await loadCoachProfile('me', {
      fetchFresh: () => Promise.reject(new Error('offline')),
      signUrl: () => Promise.reject(new Error('offline')),
    });
    expect(p).toMatchObject({ name: 'Mia Coach', bio: 'Strength coach.', avatarUrl: null });
  });

  it('returns null when the fetch fails and nothing is saved', async () => {
    const p = await loadCoachProfile('me', { fetchFresh: () => Promise.reject(new Error('offline')), signUrl: sign });
    expect(p).toBeNull();
  });

  it('does not use another user\'s saved coach', async () => {
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    const p = await loadCoachProfile('you', { fetchFresh: () => Promise.reject(new Error('offline')), signUrl: sign });
    expect(p).toBeNull();
  });

  it('forgets the saved coach when the server says there is none', async () => {
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    expect(await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(null), signUrl: sign })).toBeNull();
    expect(store.size).toBe(0);
  });

  it('has no photo link when there is no photo', async () => {
    const p = await loadCoachProfile('me', {
      fetchFresh: () => Promise.resolve({ ...record, avatarPath: null }),
      signUrl: sign,
    });
    expect(p?.avatarUrl).toBeNull();
    expect(sign).not.toHaveBeenCalled();
  });

  it('falls back to initials (no link) when signing fails', async () => {
    const p = await loadCoachProfile('me', {
      fetchFresh: () => Promise.resolve(record),
      signUrl: () => Promise.reject(new Error('nope')),
    });
    expect(p?.avatarUrl).toBeNull();
    expect(p?.name).toBe('Mia Coach');
  });

  it('carries when the client joined and their goal, also from the saved copy', async () => {
    const full = { ...record, joinedAt: '2026-11-03T10:00:00.000Z', goal: { goal: 'Squat 100 kg', targetDate: '2027-03-01' } };
    expect(await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(full), signUrl: sign })).toMatchObject({
      joinedAt: full.joinedAt,
      goal: full.goal,
    });
    const offline = await loadCoachProfile('me', { fetchFresh: () => Promise.reject(new Error('offline')), signUrl: sign });
    expect(offline).toMatchObject({ joinedAt: full.joinedAt, goal: full.goal });
  });

  it('reads a copy saved before the join date and goal were kept as having neither', async () => {
    store.set('caltracker.coach.me', JSON.stringify(record));
    const p = await loadCoachProfile('me', { fetchFresh: () => Promise.reject(new Error('offline')), signUrl: sign });
    expect(p).toMatchObject({ name: 'Mia Coach', joinedAt: null, goal: null });
  });

  it('ignores a saved copy whose goal is malformed', async () => {
    store.set('caltracker.coach.me', JSON.stringify({ ...record, goal: { goal: 3 } }));
    expect(await loadCoachProfile('me', { fetchFresh: () => Promise.reject(new Error('offline')), signUrl: sign })).toBeNull();
  });

  it('reuses the photo link on a reload (no new download each time the tab opens) until it nears expiry', async () => {
    let now = 0;
    const deps = { fetchFresh: () => Promise.resolve(record), signUrl: sign, now: () => now };
    const a = await loadCoachProfile('me', deps);
    const b = await loadCoachProfile('me', deps);
    expect(b?.avatarUrl).toBe(a?.avatarUrl);
    expect(sign).toHaveBeenCalledTimes(1);
    now = 50 * 60 * 1000;
    await loadCoachProfile('me', deps);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('never reuses another user\'s photo link', async () => {
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    await loadCoachProfile('you', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('signs again when the photo changed', async () => {
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve(record), signUrl: sign });
    await loadCoachProfile('me', { fetchFresh: () => Promise.resolve({ ...record, updatedAt: '2026-11-06T10:00:00.000Z' }), signUrl: sign });
    expect(sign).toHaveBeenCalledTimes(2);
  });
});
