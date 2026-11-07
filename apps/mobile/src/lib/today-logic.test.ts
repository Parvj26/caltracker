import { describe, expect, it } from 'vitest';
import { STICKERS } from '@caltracker/shared';
import type { FeedPost } from './community-api';
import { buildProgress, type ProgressRows } from './progress';
import {
  coachPreview,
  goalCard,
  greeting,
  headerDate,
  postPreview,
  previewTime,
  seeAllLabel,
  shareWorkoutTitle,
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

  it('shows a clock time today and a day before that', () => {
    const now = '2026-11-07T15:00:00Z';
    expect(previewTime('2026-11-07T14:05:00Z', now, 'UTC')).toBe('2:05 pm');
    expect(previewTime('2026-11-06T23:57:00Z', now, 'UTC')).toBe('Yesterday');
    expect(previewTime('2026-11-02T10:00:00Z', now, 'UTC')).toBe('Mon 2 Nov');
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
    images: [],
    likerIds: [],
    likerNames: [],
    commentCount: 0,
    ...over,
  });
  const ctx = { me: 'me', coaches: new Set(['coach']), units: 'lb' as const };

  it('shows the author (marking the coach and me), the words and the likes and comments', () => {
    const p = postPreview(
      post({ likerIds: ['me'], commentCount: 1, images: [{ id: 'i', path: 'a.webp', thumbPath: 'a-thumb.webp', width: 1, height: 1 }] }),
      ctx,
    );
    expect(p).toEqual({ id: 'p1', author: 'Smoke Coach · Coach', snippet: 'Happy Diwali', stats: '❤️ 1 · 1 comment', thumbPath: 'a-thumb.webp', stickerKey: null });
    expect(postPreview(post({ authorId: 'me', commentCount: 2 }), ctx)).toMatchObject({ author: 'You', stats: '2 comments' });
    expect(postPreview(post({ authorId: 'vk', authorName: 'VK' }), ctx)).toMatchObject({ author: 'VK', stats: '' });
  });

  it('describes a shared card without words, with its sticker', () => {
    const lion = STICKERS.find((s) => s.kind === 'ladder')!.key;
    const p = postPreview(
      post({
        body: '',
        card: { kind: 'workout', logId: 'l', workoutName: 'Lower Body', finishedAt: null, exerciseCount: 4, setCount: 12, stickerKey: lion, multiple: 3, shiny: false },
      }),
      ctx,
    );
    expect(p.snippet).toBe('Workout done · Lower Body');
    expect(p.stickerKey).toBe(lion);
  });

  it('labels See all with the new notifications', () => {
    expect(seeAllLabel(0)).toBe('See all');
    expect(seeAllLabel(1)).toBe('See all · 1 new');
    expect(seeAllLabel(120)).toBe('See all · 99+ new');
  });

  it('offers sharing only for today’s or yesterday’s workout, named by its day', () => {
    expect(shareWorkoutTitle('2026-11-07T09:00:00Z', '2026-11-07', 'UTC')).toBe('Share today’s workout');
    expect(shareWorkoutTitle('2026-11-06T09:00:00Z', '2026-11-07', 'UTC')).toBe('Share yesterday’s workout');
    // Only for two days: older (or undated) workouts get no button.
    expect(shareWorkoutTitle('2026-11-05T23:59:00Z', '2026-11-07', 'UTC')).toBeNull();
    expect(shareWorkoutTitle('2026-11-01T09:00:00Z', '2026-11-07', 'UTC')).toBeNull();
    expect(shareWorkoutTitle(null, '2026-11-07', 'UTC')).toBeNull();
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

describe('goal card', () => {
  const TODAY = '2026-11-05';
  const rows = (over: Partial<ProgressRows>): ProgressRows => ({ scans: [], customs: [], goal: null, ...over });
  const scan = (id: string, measuredOn: string, values: Record<string, number>) => ({
    id,
    measuredOn,
    createdAt: `${measuredOn}T08:00:00Z`,
    source: 'coach' as const,
    attachmentPath: null,
    values,
  });

  it('is hidden with no goal and no scans', () => {
    expect(goalCard(buildProgress(rows({}), '1y', 'kg', TODAY))).toBeNull();
  });

  it('shows the goal with its countdown and short tiles with the 3-month change', () => {
    const model = buildProgress(
      rows({
        goal: { goal: 'Lose 5 kg', targetDate: '2026-12-24' },
        scans: [scan('a', '2026-09-01', { weight_kg: 82, body_fat_pct: 20 }), scan('b', '2026-11-01', { weight_kg: 80, body_fat_pct: 19, smm_kg: 35 })],
      }),
      '1y',
      'kg',
      TODAY,
    );
    expect(goalCard(model)).toEqual({
      goal: 'Lose 5 kg',
      countdown: '49 days to go',
      tiles: [
        { key: 'weight_kg', label: 'Weight', value: '80 kg', change: '−2 kg' },
        { key: 'body_fat_pct', label: 'Body fat', value: '19.0%', change: '−1%' },
        { key: 'smm_kg', label: 'Muscle', value: '35 kg', change: null },
      ],
    });
  });

  it('shows the numbers without a goal, and a goal without numbers', () => {
    expect(goalCard(buildProgress(rows({ scans: [scan('a', '2026-11-01', { weight_kg: 80 })] }), '1y', 'kg', TODAY))).toMatchObject({
      goal: null,
      countdown: null,
    });
    expect(goalCard(buildProgress(rows({ goal: { goal: 'Run 5k', targetDate: null } }), '1y', 'kg', TODAY))).toEqual({
      goal: 'Run 5k',
      countdown: null,
      tiles: [],
    });
  });
});
