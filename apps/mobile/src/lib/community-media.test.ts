import { describe, expect, it } from 'vitest';
import { avatarThumb, feedAvatarPaths } from './community-media';

const comment = (authorId: string, authorAvatarPath: string | null) => ({ authorId, authorAvatarPath });

describe('feedAvatarPaths', () => {
  it('takes the thumbnails of post authors, comment preview authors and extra paths, once each', () => {
    const posts = [
      { authorAvatarPath: 'u/a/avatar.webp', recentComments: [comment('b', 'u/b/avatar.jpg'), comment('a', 'u/a/avatar.webp')] },
      { authorAvatarPath: null, recentComments: [] },
    ];
    expect(feedAvatarPaths(posts, ['u/me/avatar.webp', null], new Set())).toEqual([
      'u/me/avatar-thumb.webp',
      'u/a/avatar-thumb.webp',
      'u/b/avatar-thumb.jpg',
    ]);
  });

  it('signs nothing for comments by people I blocked', () => {
    const posts = [{ authorAvatarPath: null, recentComments: [comment('blocked', 'u/x/avatar.webp'), comment('ok', 'u/y/avatar.webp')] }];
    expect(feedAvatarPaths(posts, [], new Set(['blocked']))).toEqual(['u/y/avatar-thumb.webp']);
  });
});

describe('avatarThumb', () => {
  it('points at the thumbnail', () => {
    expect(avatarThumb('u/a/avatar.jpg')).toBe('u/a/avatar-thumb.jpg');
  });
});
