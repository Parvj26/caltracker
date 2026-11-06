import { describe, expect, it } from 'vitest';
import { LANDMARK_JOURNEY, STICKERS } from '@caltracker/shared';
import { albumCacheKey, albumCachePrefix, albumModel, parseAlbumCache, workoutShareLine, type AlbumAward, type AlbumStats } from './album-logic';

const stats = (over: Partial<AlbumStats> = {}): AlbumStats => ({
  workouts: 0,
  streak: 0,
  streakWeek: null,
  bestStreak: 0,
  journeyWeek: 0,
  prCount: 0,
  lifetimeVolumeKg: 0,
  ...over,
});
const award = (key: string, over: Partial<AlbumAward> = {}): AlbumAward => ({
  key,
  count: 1,
  shiny: false,
  firstEarnedAt: '2026-11-05T10:00:00Z',
  ...over,
});

describe('albumModel', () => {
  it('an empty book has 30 locked animals, 10 locked rares, 3 mystery drops', () => {
    const m = albumModel([], null);
    expect(m.animals.items).toHaveLength(30);
    expect(m.animals.items.every((a) => !a.owned)).toBe(true);
    expect(m.animals.title).toBe('0 of 30 · Shiny 0 / 30');
    expect(m.rare.title).toBe('0 of 10');
    expect(m.drops).toHaveLength(3);
    expect(m.drops.every((d) => !d.owned)).toBe(true);
    expect(m.journey.streak).toBe(0);
  });

  it('orders animals by weight and counts owned and shiny', () => {
    const m = albumModel([award('hippo', { count: 3, shiny: true }), award('rabbit'), award('cat', { shiny: true })], null);
    const keys = m.animals.items.map((a) => a.key);
    expect(keys[0]).toBe('rabbit');
    expect(keys.indexOf('cat')).toBeLessThan(keys.indexOf('hippo'));
    expect(m.animals.title).toBe('3 of 30 · Shiny 2 / 30');
    const hippo = m.animals.items.find((a) => a.key === 'hippo');
    expect(hippo).toMatchObject({ owned: true, count: 3, shiny: true, badge: '×3' });
    expect(m.animals.items.find((a) => a.key === 'rabbit')?.badge).toBe('×1');
    expect(m.animals.items.find((a) => a.key === 'cow')).toMatchObject({ owned: false, badge: null, shiny: false });
  });

  it('shows the requirement on locked rare finds and none on owned ones', () => {
    const m = albumModel([award('okapi')], null);
    expect(m.rare.title).toBe('1 of 10');
    expect(m.rare.items.find((r) => r.key === 'okapi')).toMatchObject({ owned: true, requirement: null });
    expect(m.rare.items.find((r) => r.key === 'quokka')?.requirement).toBe('4-week streak');
    expect(m.rare.items.find((r) => r.key === 'axolotl')?.requirement).toBe('10 workouts');
    expect(m.rare.items.find((r) => r.key === 'fennec-fox')?.requirement).toBe('5 personal bests');
    expect(m.rare.items.find((r) => r.key === 'narwhal')?.requirement).toBe('1,000,000 kg lifted');
  });

  it('keeps drops hidden until found', () => {
    const m = albumModel([award('kakapo')], null);
    expect(m.drops.filter((d) => d.owned).map((d) => d.key)).toEqual(['kakapo']);
    expect(m.drops.filter((d) => !d.owned)).toHaveLength(2);
  });

  it('builds the journey from the stats: dots, next landmark, collected row', () => {
    const m = albumModel([award('chichen-itza'), award('christ-the-redeemer', { count: 2 })], stats({ streak: 2, journeyWeek: 2 }));
    expect(m.journey.streak).toBe(2);
    expect(m.journey.title).toBe('🔥 2-week streak');
    expect(m.journey.next).toEqual({ key: 'petra', name: 'Petra', week: 3 });
    expect(m.journey.nextLabel).toBe('next: Petra');
    expect(m.journey.dots).toHaveLength(LANDMARK_JOURNEY.length);
    expect(m.journey.dots.map((d) => d.reached)).toEqual(LANDMARK_JOURNEY.map((s) => s.week <= 2));
    expect(m.journey.collected.map((c) => c.key)).toEqual(['chichen-itza', 'christ-the-redeemer']);
    expect(m.journey.collected[1].badge).toBe('×2');
  });

  it('has no next landmark at the end of the journey', () => {
    const m = albumModel([], stats({ streak: 60, journeyWeek: 60 }));
    expect(m.journey.next).toBeNull();
    expect(m.journey.nextLabel).toBe('every landmark collected');
  });

  it('ignores awards whose sticker is not in the catalogue', () => {
    const m = albumModel([award('dodo')], null);
    expect(m.animals.title).toBe('0 of 30 · Shiny 0 / 30');
  });

  it('covers the whole catalogue', () => {
    const m = albumModel([], null);
    expect(m.animals.items.length + m.rare.items.length + m.drops.length + LANDMARK_JOURNEY.length).toBe(STICKERS.length);
  });
});

describe('albumModel streak as of this week', () => {
  it('keeps a streak whose last week is this week or last week', () => {
    expect(albumModel([], stats({ streak: 3, streakWeek: '2026-11-02' }), 'kg', '2026-11-02').journey.streak).toBe(3);
    expect(albumModel([], stats({ streak: 3, streakWeek: '2026-10-26' }), 'kg', '2026-11-02').journey.streak).toBe(3);
  });
  it('shows 0 once a whole week went by without a workout', () => {
    const m = albumModel([], stats({ streak: 3, streakWeek: '2026-10-19' }), 'kg', '2026-11-02');
    expect(m.journey.streak).toBe(0);
    expect(m.journey.title).toBe('🔥 0-week streak');
    expect(m.journey.dots.every((d) => !d.reached)).toBe(true);
  });
});

describe('albumCacheKey', () => {
  it('keeps one copy per coach, all under the user prefix', () => {
    expect(albumCacheKey('u1', 'wsA')).not.toBe(albumCacheKey('u1', 'wsB'));
    expect(albumCacheKey('u1', 'wsA').startsWith(`${albumCachePrefix('u1')}.`)).toBe(true);
  });
});

describe('parseAlbumCache', () => {
  it('reads an old copy without a streak week as having none', () => {
    const old = { awards: [], stats: { workouts: 1, streak: 2, bestStreak: 2, journeyWeek: 2, prCount: 0, lifetimeVolumeKg: 0 } };
    expect(parseAlbumCache(JSON.stringify(old))?.stats?.streakWeek).toBeNull();
  });
  it('round-trips and rejects junk', () => {
    const data = { awards: [award('cat')], stats: stats({ streak: 1, streakWeek: '2026-11-02' }) };
    expect(parseAlbumCache(JSON.stringify(data))).toEqual(data);
    expect(parseAlbumCache('nope')).toBeNull();
    expect(parseAlbumCache(null)).toBeNull();
    expect(parseAlbumCache(JSON.stringify({ awards: 3 }))).toBeNull();
  });
});

describe('workoutShareLine', () => {
  it('joins the volume and the multiple', () => {
    expect(workoutShareLine(1440, 'lb', 1.2, 'Giraffe')).toBe('3,175 lb ≈ 1.2 Giraffes');
    expect(workoutShareLine(1500, 'kg', 1, 'Hippo')).toBe('1,500 kg ≈ 1 Hippo');
  });
});
