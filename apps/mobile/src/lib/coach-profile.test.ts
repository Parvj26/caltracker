import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => Promise.resolve(void store.set(k, v)),
    removeItem: (k: string) => Promise.resolve(void store.delete(k)),
  },
}));

import { loadCoachProfile, thumbPath, withVersion, type CoachRecord } from './coach-profile';

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
});

describe('thumbPath', () => {
  it('points at the thumbnail with the same extension', () => {
    expect(thumbPath('u1/avatar.webp')).toBe('u1/avatar-thumb.webp');
    expect(thumbPath('u1/avatar.jpg')).toBe('u1/avatar-thumb.jpg');
  });
  it('leaves an unexpected path alone', () => {
    expect(thumbPath('u1/other.png')).toBe('u1/other.png');
  });
});

describe('withVersion', () => {
  it('adds a cache-busting version to a signed link', () => {
    expect(withVersion('https://x/a?token=t', '2026-11-05T10:00:00.000Z')).toBe(
      `https://x/a?token=t&v=${Date.parse('2026-11-05T10:00:00.000Z')}`,
    );
    expect(withVersion('https://x/a', null)).toBe('https://x/a?v=0');
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
});
