import { describe, expect, it } from 'vitest';
import { albumCacheKey, albumCachePrefix } from './album-logic';
import { keysToForget, notificationPrefsKey, todayCacheKey } from './device-cache-keys';

describe('keysToForget', () => {
  const keys = [
    todayCacheKey('name', 'u1'),
    todayCacheKey('posts.c1', 'u1'),
    todayCacheKey('prs.w1', 'u1'),
    todayCacheKey('name', 'u2'),
    albumCachePrefix('u1'),
    albumCacheKey('u1', 'w1'),
    albumCacheKey('u2', 'w1'),
    'caltracker.units.u1',
    'caltracker.reveals.u1',
    'caltracker.todayLogs.u1',
  ];

  it('forgets every Today copy and this user’s sticker books, nothing else', () => {
    expect(keysToForget(keys, 'u1')).toEqual([
      'caltracker.today.name.u1',
      'caltracker.today.posts.c1.u1',
      'caltracker.today.prs.w1.u1',
      'caltracker.today.name.u2',
      'caltracker.album.u1',
      'caltracker.album.u1.w1',
    ]);
  });

  it('forgets this user’s food log copies but not the queue of meals still to send', () => {
    const food = ['caltracker.food.u1.w1', 'caltracker.food.u2.w1', 'caltracker.foodQueue.u1.w1'];
    expect(keysToForget(food, 'u1')).toEqual(['caltracker.food.u1.w1']);
  });

  it('forgets this user’s older Progress copies (body and strength), not another user’s', () => {
    const old = ['caltracker.progress.u1', 'caltracker.strength.u1', 'caltracker.progress.u2', 'caltracker.strength.u2'];
    expect(keysToForget(old, 'u1')).toEqual(['caltracker.progress.u1', 'caltracker.strength.u1']);
  });

  it('still forgets the Today copies when the user is unknown', () => {
    expect(keysToForget(keys, null)).toEqual(keys.filter((k) => k.startsWith('caltracker.today.')));
  });

  it('forgets this user’s notification prefs copy', () => {
    expect(notificationPrefsKey('u1')).toBe('caltracker.notificationPrefs.u1');
    expect(keysToForget(['caltracker.notificationPrefs.u1', 'caltracker.notificationPrefs.u2'], 'u1')).toEqual([
      'caltracker.notificationPrefs.u1',
    ]);
  });
});
