import { describe, expect, it } from 'vitest';
import { STICKERS } from '@caltracker/shared';
import type { FeedPost } from './community-api';
import {
  coachPreview,
  greeting,
  headerDate,
  postPreview,
  unreadLabel,
  zooHref,
  zooSummary,
} from './today-logic';

describe('header', () => {
  it('reads the phone’s date in full', () => {
    expect(headerDate('2026-11-07')).toBe('Saturday 7 November');
    expect(headerDate('2026-11-08')).toBe('Sunday 8 November');
    expect(headerDate('2027-01-01')).toBe('Friday 1 January');
  });

  it('greets by first name, or plainly while it isn’t known', () => {
    expect(greeting('Parv')).toBe('Hi Parv');
    expect(greeting('  Mary Ann ')).toBe('Hi Mary');
    expect(greeting(null)).toBe('Hi there');
    expect(greeting(' ')).toBe('Hi there');
  });
});

describe('coach preview', () => {
  const msg = (body: string, createdAt: string, senderId?: string, imagePaths: string[] = []) => ({ body, createdAt, senderId, imagePaths });

  it('shows the newest message, marking my own', () => {
    expect(
      coachPreview([msg('Old', '2026-11-06T10:00:00Z', 'coach'), msg('Great   session\nyesterday', '2026-11-06T23:57:00Z', 'coach')], 'me'),
    ).toEqual({ text: 'Great session yesterday', at: '2026-11-06T23:57:00Z' });
    expect(coachPreview([msg('Thanks!', '2026-11-07T08:00:00Z', 'me')], 'me')?.text).toBe('You: Thanks!');
    // Still on its way from this phone (no sender yet): mine.
    expect(coachPreview([msg('On its way', '2026-11-07T08:00:00Z')], 'me')?.text).toBe('You: On its way');
  });

  it('describes a photo without words, and is null with no messages', () => {
    expect(coachPreview([msg('', '2026-11-07T08:00:00Z', 'coach', ['a.jpg'])], 'me')?.text).toBe('Photo');
    expect(coachPreview([msg('', '2026-11-07T08:00:00Z', 'coach', ['a.jpg', 'b.jpg'])], 'me')?.text).toBe('2 photos');
    expect(coachPreview([], 'me')).toBeNull();
  });

  it('labels the unread count for VoiceOver', () => {
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(1)).toBe('1 unread message');
    expect(unreadLabel(3)).toBe('3 unread messages');
  });
});

describe('community', () => {
  const post = (over: Partial<FeedPost>): FeedPost => ({
    id: 'p1',
    authorId: 'coach',
    authorName: 'Smoke Coach',
    authorAvatarPath: null,
    body: 'Happy Diwali',
    card: null,
    createdAt: '2026-11-06T10:00:00Z',
    pinnedAt: null,
    pinnedBy: null,
    images: [],
    reactions: [],
    commentCount: 0,
    recentComments: [],
    ...over,
  });
  const ctx = { me: 'me', coaches: new Set(['coach']), units: 'lb' as const };

  it('names the author (marking the coach and me) with the words, and nothing else', () => {
    expect(postPreview(post({ commentCount: 1 }), ctx)).toEqual({ author: 'Smoke Coach · Coach', snippet: 'Happy Diwali' });
    expect(postPreview(post({ authorId: 'me' }), ctx)).toEqual({ author: 'You', snippet: 'Happy Diwali' });
    expect(postPreview(post({ authorId: 'vk', authorName: 'VK' }), ctx)).toEqual({ author: 'VK', snippet: 'Happy Diwali' });
  });

  it('describes a shared card without words', () => {
    const lion = STICKERS.find((s) => s.kind === 'ladder')!.key;
    const p = postPreview(
      post({
        body: '',
        card: { kind: 'workout', logId: 'l', workoutName: 'Lower Body', finishedAt: null, exerciseCount: 4, setCount: 12, stickerKey: lion, multiple: 3, shiny: false },
      }),
      ctx,
    );
    // An older card (no volume stored): the label and the workout's name.
    expect(p.snippet).toBe('Workout done · Lower Body');
  });

  it('says a photo-only post was a photo', () => {
    expect(postPreview(post({ body: '', images: [{ id: 'i', path: 'a.webp', thumbPath: 'a-thumb.webp', width: 1, height: 1 }] }), ctx).snippet).toBe('Shared a photo');
  });

  it('uses the card sentence, about the poster, when the card has one', () => {
    const card = { kind: 'workout' as const, logId: 'l', workoutName: 'VK Upper', finishedAt: null, exerciseCount: 11, setCount: 10, stickerKey: 'cow', multiple: 1, shiny: false, volumeKg: 698.53 };
    expect(postPreview(post({ body: '', authorId: 'vk', authorName: 'Vaishali Kapoor', card }), ctx).snippet).toBe(
      'Vaishali lifted 1,540 lb — about as much as 1 cow 🐄',
    );
    expect(postPreview(post({ body: '', authorId: 'me', card }), ctx).snippet).toBe('You lifted 1,540 lb — about as much as 1 cow 🐄');
    expect(postPreview(post({ body: '', authorId: 'vk', authorName: 'Vaishali', card: { kind: 'sticker', stickerKey: 'lion', shiny: false, count: 1 } }), ctx).snippet).toBe(
      'Vaishali earned the Lion sticker 🦁',
    );
  });

});

describe('zoo', () => {
  const [a, b] = STICKERS;
  it('picks the sticker first earned most recently and counts the whole book', () => {
    const z = zooSummary([
      { key: a.key, count: 3, shiny: false, firstEarnedAt: '2026-11-01T10:00:00Z' },
      { key: b.key, count: 1, shiny: true, firstEarnedAt: '2026-11-05T10:00:00Z' },
      { key: 'retired-sticker', count: 1, shiny: false, firstEarnedAt: '2026-11-06T10:00:00Z' },
    ]);
    expect(z.newest).toEqual({ key: b.key, name: b.name, shiny: true, earnedAt: '2026-11-05T10:00:00Z' });
    expect(z.owned).toBe(2);
    expect(z.total).toBe(STICKERS.length);
    expect(z.label).toBe(`Zoo 2 of ${STICKERS.length}`);
    expect(z.fraction).toBeCloseTo(2 / STICKERS.length);
  });

  it('is empty before the first sticker', () => {
    expect(zooSummary([])).toMatchObject({ newest: null, owned: 0, label: `Zoo 0 of ${STICKERS.length}`, fraction: 0 });
  });

  it('routes through one helper', () => {
    expect(zooHref()).toBe('/zoo');
  });
});
