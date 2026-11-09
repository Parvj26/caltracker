import { describe, expect, it } from 'vitest';
import type { Message, OutboxItem } from '@caltracker/shared';
import { QUICK_REPLIES, buildChatRows, coachFirstName, coachSinceLabel, goalCountdown, type WorkoutComment } from './coach-tab';

const TZ = 'Europe/London';
const NOW = '2026-11-09T12:00:00.000Z';

const msg = (id: string, createdAt: string, senderId = 'coach'): Message => ({
  id,
  clientMsgId: `c-${id}`,
  senderId,
  body: id,
  imagePaths: [],
  createdAt,
});
const pending = (clientMsgId: string, createdAt: string): OutboxItem => ({ clientMsgId, body: 'x', imagePaths: [], createdAt, state: 'sending' });
const comment = (id: string, createdAt: string): WorkoutComment => ({
  id,
  logId: 'log-1',
  body: 'Keep elbows tucked.',
  createdAt,
  workoutName: 'Upper A',
  workoutAt: '2026-11-06T09:00:00.000Z',
});

describe('coachFirstName', () => {
  it('takes the first word', () => expect(coachFirstName('Luis  Bueno')).toBe('Luis'));
  it('is null for no name', () => {
    expect(coachFirstName(null)).toBeNull();
    expect(coachFirstName('   ')).toBeNull();
  });
});

describe('coachSinceLabel', () => {
  it('names the month and year the client joined, in their time zone', () => {
    expect(coachSinceLabel('2026-11-03T10:00:00.000Z', TZ)).toBe('Your coach since November 2026');
    // 23:30 UTC on 31 Jan is already February in Tokyo.
    expect(coachSinceLabel('2026-01-31T23:30:00.000Z', 'Asia/Tokyo')).toBe('Your coach since February 2026');
  });
  it('is null when the date is unknown or unreadable', () => {
    expect(coachSinceLabel(null, TZ)).toBeNull();
    expect(coachSinceLabel(undefined, TZ)).toBeNull();
    expect(coachSinceLabel('not a date', TZ)).toBeNull();
  });
});

describe('goalCountdown', () => {
  it('splits the number from the words', () => {
    expect(goalCountdown('2027-03-01', '2026-11-09')).toEqual({ number: '112', label: 'days to go' });
    expect(goalCountdown('2026-11-10', '2026-11-09')).toEqual({ number: '1', label: 'day to go' });
  });
  it('has words only on the day and after it', () => {
    expect(goalCountdown('2026-11-09', '2026-11-09')).toEqual({ number: null, label: 'Today' });
    expect(goalCountdown('2026-11-06', '2026-11-09')).toEqual({ number: null, label: 'Passed 3 days ago' });
  });
  it('is null for a goal without a date', () => expect(goalCountdown(null, '2026-11-09')).toBeNull());
});

describe('QUICK_REPLIES', () => {
  it('are the three approved replies', () => expect(QUICK_REPLIES).toEqual(['Done for today', 'Can we swap a day?', 'Something hurts']));
});

describe('buildChatRows', () => {
  it('puts day labels before each day, newest row first (for the inverted list)', () => {
    const rows = buildChatRows({
      items: [msg('a', '2026-11-08T10:00:00.000Z'), msg('b', '2026-11-09T09:00:00.000Z', 'me')],
      comments: [],
      hasMore: false,
      now: NOW,
      timeZone: TZ,
    });
    expect(rows.map((r) => (r.kind === 'day' ? r.label : r.kind))).toEqual(['message', 'Today', 'message', 'Yesterday']);
  });

  it('weaves workout comments in among the messages by time', () => {
    const rows = buildChatRows({
      items: [msg('a', '2026-11-08T10:00:00.000Z'), pending('p', '2026-11-08T12:00:00.000Z')],
      comments: [comment('k', '2026-11-08T11:00:00.000Z')],
      hasMore: false,
      now: NOW,
      timeZone: TZ,
    }).reverse();
    expect(rows.map((r) => r.key)).toEqual([expect.stringMatching(/^day-/), 'c-a', 'comment-k', 'p']);
  });

  it('labels the comment card with the workout and its day', () => {
    const [row] = buildChatRows({ items: [], comments: [comment('k', '2026-11-08T11:00:00.000Z')], hasMore: false, now: NOW, timeZone: TZ });
    expect(row).toMatchObject({ kind: 'comment', title: 'Upper A · Fri 6 Nov', comment: { logId: 'log-1' } });
  });

  it('leaves out comments older than the loaded messages while earlier messages remain', () => {
    const input = {
      items: [msg('a', '2026-11-08T10:00:00.000Z')],
      comments: [comment('old', '2026-11-01T10:00:00.000Z'), comment('new', '2026-11-08T11:00:00.000Z')],
      now: NOW,
      timeZone: TZ,
    };
    const keys = (hasMore: boolean) => buildChatRows({ ...input, hasMore }).filter((r) => r.kind === 'comment').map((r) => r.key);
    expect(keys(true)).toEqual(['comment-new']);
    expect(keys(false)).toEqual(['comment-new', 'comment-old']);
  });

  it('is empty with nothing to show', () =>
    expect(buildChatRows({ items: [], comments: [], hasMore: false, now: NOW, timeZone: TZ })).toEqual([]));
});
