import { describe, expect, it } from 'vitest';
import {
  CommentInput,
  PostInput,
  ReportInput,
  badgeLabel,
  cardRequestLabel,
  canBlock,
  canDelete,
  canPin,
  canReport,
  cardText,
  communityPhotoPaths,
  firstYoutubeId,
  fitLongEdge,
  groupNotifications,
  groupedLikeText,
  initialsOf,
  likersLine,
  memberName,
  notificationText,
  parseCard,
  parseCardRequest,
  postAge,
  sortFeed,
  splitLinks,
  unreadNotificationCount,
  withoutBlocked,
  type NotificationRow,
} from '../../src';

const LOG = '11111111-1111-4111-8111-111111111111';

describe('likes', () => {
  it('groups likes the way the spec words it', () => {
    expect(groupedLikeText(['Sam'])).toBe('Sam liked your post');
    expect(groupedLikeText(['Sam', 'Kim'])).toBe('Sam and Kim liked your post');
    expect(groupedLikeText(['Sam', 'Kim', 'Lee', 'Max', 'Ana'])).toBe('Sam and 4 others liked your post');
    expect(groupedLikeText(['Sam'], 2)).toBe('Sam and 1 other liked your post');
    expect(groupedLikeText([], 0)).toBe('Someone liked your post');
  });

  it('words the line under a post', () => {
    expect(likersLine([], false)).toBe('');
    expect(likersLine([], true)).toBe('You like this');
    expect(likersLine(['Sam'], true)).toBe('You and Sam like this');
    expect(likersLine(['Sam', 'Kim', 'Lee'], true)).toBe('You and 3 others like this');
    expect(likersLine(['Sam'], false)).toBe('Sam likes this');
    expect(likersLine(['Sam', 'Kim'], false)).toBe('Sam and Kim like this');
    expect(likersLine(['Sam', 'Kim', 'Lee'], false)).toBe('Sam and 2 others like this');
  });
});

describe('notifications', () => {
  const row = (id: string, kind: NotificationRow['kind'], actorId: string, createdAt: string, extra: Partial<NotificationRow> = {}): NotificationRow => ({
    id,
    kind,
    postId: 'p1',
    commentId: null,
    actorId,
    createdAt,
    readAt: null,
    ...extra,
  });

  const rows: NotificationRow[] = [
    row('n1', 'like', 'kim', '2026-11-06T10:00:00Z', { readAt: '2026-11-06T10:05:00Z' }),
    row('n2', 'like', 'sam', '2026-11-06T11:00:00Z'),
    row('n3', 'comment', 'kim', '2026-11-06T10:30:00Z'),
    row('n4', 'like', 'lee', '2026-11-06T09:00:00Z', { postId: 'p2', readAt: '2026-11-06T09:30:00Z' }),
    row('n5', 'coach_post', 'coach', '2026-11-06T12:00:00Z', { postId: 'p3' }),
    row('n6', 'like', 'max', '2026-11-06T08:00:00Z'),
  ];
  const names: Record<string, string> = { kim: 'Kim', sam: 'Sam', lee: 'Lee', coach: 'Coach Jo', max: 'Max' };

  it('groups likes per post, newest first, and keeps other kinds separate', () => {
    const items = groupNotifications(rows);
    expect(items.map((i) => i.key)).toEqual(['n5', 'n2', 'n3', 'n4']);
    const likes = items[1]!;
    expect(likes.actorIds).toEqual(['sam', 'kim', 'max']);
    expect(likes.ids.sort()).toEqual(['n1', 'n2', 'n6']);
    expect(likes.unread).toBe(true);
    expect(notificationText(likes, (id) => names[id] ?? '?')).toBe('Sam and 2 others liked your post');
    expect(items[3]!.unread).toBe(false);
  });

  it('counts unread items after grouping', () => {
    expect(unreadNotificationCount(groupNotifications(rows))).toBe(3);
    expect(badgeLabel(0)).toBeNull();
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(120)).toBe('99+');
  });

  it('drops anyone the reader blocked', () => {
    const items = groupNotifications(rows, new Set(['sam', 'kim']));
    expect(items.map((i) => i.key)).toEqual(['n5', 'n4', 'n6']);
    expect(notificationText(items[2]!, (id) => names[id] ?? '?')).toBe('Max liked your post');
  });

  it('words comments, coach posts and reports', () => {
    const [coachPost, , comment] = groupNotifications(rows);
    expect(notificationText(coachPost!, (id) => names[id] ?? '?')).toBe('Coach Jo posted in the community');
    expect(notificationText(comment!, (id) => names[id] ?? '?')).toBe('Kim commented on your post');
    const [report] = groupNotifications([row('r', 'report', 'kim', '2026-11-06T10:00:00Z')]);
    expect(notificationText(report!, (id) => names[id] ?? '?')).toBe('Kim reported something in the community');
  });
});

describe('feed', () => {
  const post = (id: string, createdAt: string, pinnedAt: string | null = null, authorId = 'a') => ({ id, authorId, createdAt, pinnedAt });

  it('puts pinned posts first, most recently pinned on top, then newest first', () => {
    const sorted = sortFeed([
      post('old', '2026-11-01T00:00:00Z'),
      post('pinned-early', '2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z'),
      post('new', '2026-11-05T00:00:00Z'),
      post('pinned-late', '2026-10-02T00:00:00Z', '2026-11-04T00:00:00Z'),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(['pinned-late', 'pinned-early', 'new', 'old']);
  });

  it('hides blocked authors', () => {
    expect(withoutBlocked([post('1', 'x', null, 'sam'), post('2', 'x', null, 'kim')], new Set(['sam'])).map((p) => p.id)).toEqual(['2']);
  });

  it('decides which buttons to show', () => {
    const client = { userId: 'me', isCoach: false };
    const coach = { userId: 'coach', isCoach: true };
    expect(canDelete(client, 'me')).toBe(true);
    expect(canDelete(client, 'other')).toBe(false);
    expect(canDelete(coach, 'other')).toBe(true);
    expect(canPin(client)).toBe(false);
    expect(canPin(coach)).toBe(true);
    expect(canReport(client, 'me')).toBe(false);
    expect(canReport(client, 'other')).toBe(true);
    expect(canBlock(client, { id: 'other', isCoach: false })).toBe(true);
    expect(canBlock(client, { id: 'coach', isCoach: true })).toBe(false);
    expect(canBlock(client, { id: 'me', isCoach: false })).toBe(false);
    expect(canBlock(coach, { id: 'other', isCoach: false })).toBe(false);
  });

  it('names members and falls back for people who left', () => {
    expect(memberName({ firstName: 'Sam', lastName: 'Lee' })).toBe('Sam Lee');
    expect(memberName({ firstName: 'Sam', lastName: '' })).toBe('Sam');
    expect(memberName(null)).toBe('Former member');
    expect(initialsOf('Sam Lee')).toBe('SL');
    expect(initialsOf('sam')).toBe('S');
    expect(initialsOf(' ')).toBe('?');
  });

  it('shows short relative times', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(postAge('2026-11-06T11:59:30Z', now)).toBe('Just now');
    expect(postAge('2026-11-06T11:55:00Z', now)).toBe('5m');
    expect(postAge('2026-11-06T09:00:00Z', now)).toBe('3h');
    expect(postAge('2026-11-04T12:00:00Z', now)).toBe('2d');
    expect(postAge('2026-10-01T08:00:00Z', now)).toBe('Oct 1');
    expect(postAge('2025-10-01T08:00:00Z', now)).toBe('Oct 1, 2025');
    expect(postAge('nonsense', now)).toBe('');
  });
});

describe('links', () => {
  it('finds http(s) and www links, leaving trailing punctuation out', () => {
    expect(splitLinks('See https://caltracker.app/x, and www.example.com.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://caltracker.app/x', href: 'https://caltracker.app/x' },
      { kind: 'text', text: ', and ' },
      { kind: 'link', text: 'www.example.com', href: 'https://www.example.com' },
      { kind: 'text', text: '.' },
    ]);
    expect(splitLinks('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
  });

  it('never links other schemes', () => {
    expect(splitLinks('javascript:alert(1)').every((s) => s.kind === 'text')).toBe(true);
  });

  it('finds the first YouTube video', () => {
    expect(firstYoutubeId('Watch https://youtu.be/dQw4w9WgXcQ !')).toBe('dQw4w9WgXcQ');
    expect(firstYoutubeId('https://example.com')).toBeNull();
  });
});

describe('photos', () => {
  it('shrinks to 1600 px on the long edge and never enlarges', () => {
    expect(fitLongEdge(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongEdge(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitLongEdge(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(4032, 3024, 320)).toEqual({ width: 320, height: 240 });
  });

  it('puts photos in the author’s folder for the post', () => {
    expect(communityPhotoPaths('ws', 'me', 'post', 'pic', 'webp')).toEqual({ path: 'ws/me/post/pic.webp', thumbPath: 'ws/me/post/pic-thumb.webp' });
  });
});

describe('cards and input', () => {
  it('words a sticker card with its tier (the sentences are in card-sentence.test.ts)', () => {
    expect(cardText({ kind: 'sticker', stickerKey: 'okapi', shiny: false, count: 1 }, 'kg', 'Vaishali K')).toMatchObject({ badge: 'Rare find!' });
    expect(cardText({ kind: 'sticker', stickerKey: 'cat', shiny: true, count: 2 }, 'kg', 'Vaishali K')).toMatchObject({ badge: 'Shiny!' });
  });

  it('reads only cards it understands', () => {
    expect(parseCard({ kind: 'sticker', stickerKey: 'cat', shiny: false, count: 1 })).not.toBeNull();
    expect(parseCard({ kind: 'inbody', bodyFat: 20 })).toBeNull();
    expect(parseCard(null)).toBeNull();
  });

  it('asks to share only which sticker or workout, nothing else', () => {
    expect(parseCardRequest({ kind: 'sticker', stickerKey: 'cat' })).toEqual({ kind: 'sticker', stickerKey: 'cat' });
    expect(parseCardRequest({ kind: 'sticker', stickerKey: 'cat', shiny: true })).toBeNull();
    expect(parseCardRequest({ kind: 'workout', logId: LOG, volumeKg: 99999 })).toBeNull();
    expect(parseCardRequest({ kind: 'pr', logId: LOG })).toEqual({ kind: 'pr', logId: LOG });
    expect(cardRequestLabel({ kind: 'sticker', stickerKey: 'okapi' })).toBe('Your Okapi sticker');
    expect(cardRequestLabel({ kind: 'workout', logId: LOG })).toBe('Your workout card');
  });

  it('checks posts, comments and reports', () => {
    expect(PostInput.safeParse({ body: '  ', photoCount: 0, card: null }).success).toBe(false);
    expect(PostInput.safeParse({ body: '', photoCount: 1, card: null }).success).toBe(true);
    expect(PostInput.safeParse({ body: 'hi', photoCount: 5, card: null }).success).toBe(false);
    expect(PostInput.safeParse({ body: 'x'.repeat(2001), photoCount: 0, card: null }).success).toBe(false);
    expect(CommentInput.parse('  nice  ')).toBe('nice');
    expect(CommentInput.safeParse('   ').success).toBe(false);
    expect(ReportInput.safeParse({ reason: 'spam', note: '' }).success).toBe(true);
    expect(ReportInput.safeParse({ reason: 'rude', note: '' }).success).toBe(false);
  });
});
