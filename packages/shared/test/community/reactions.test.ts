import { describe, expect, it } from 'vitest';
import {
  REACTIONS,
  groupedReactionText,
  isReactionKey,
  reactionButtonLabel,
  summarizeReactions,
  toggleReaction,
  whoReactedLabel,
  type ReactionRow,
} from '../../src';

const row = (userId: string, reaction: ReactionRow['reaction'], createdAt: string, name = userId): ReactionRow => ({
  userId,
  reaction,
  createdAt,
  name,
});

describe('reaction set', () => {
  it('is the fixed six, in order, stored as keys', () => {
    expect(REACTIONS.map((r) => r.key)).toEqual(['heart', 'muscle', 'fire', 'clap', 'laugh', 'party']);
    expect(REACTIONS.map((r) => r.emoji)).toEqual(['❤️', '💪', '🔥', '👏', '😂', '🎉']);
    expect(REACTIONS.map((r) => r.label)).toEqual(['heart', 'muscle', 'fire', 'clap', 'laugh', 'party']);
  });

  it('knows its keys', () => {
    expect(isReactionKey('fire')).toBe(true);
    expect(isReactionKey('like')).toBe(false);
    expect(isReactionKey('🔥')).toBe(false);
    expect(isReactionKey(null)).toBe(false);
  });
});

describe('summarizeReactions', () => {
  const rows = [
    row('kim', 'fire', '2026-11-06T10:00:00Z', 'Kim'),
    row('me', 'heart', '2026-11-06T11:00:00Z', 'Me Myself'),
    row('sam', 'fire', '2026-11-06T12:00:00Z', 'Sam'),
    row('me', 'fire', '2026-11-06T09:00:00Z', 'Me Myself'),
    row('lee', 'heart', '2026-11-06T08:00:00Z', 'Lee'),
  ];

  it('groups in the fixed order, only the used ones, with counts and "you reacted"', () => {
    const s = summarizeReactions(rows, 'me');
    expect(s.map((r) => [r.key, r.count, r.mine])).toEqual([
      ['heart', 2, true],
      ['fire', 3, true],
    ]);
    expect(s[0]!.emoji).toBe('❤️');
  });

  it('lists who reacted, newest first, without repeats', () => {
    const fire = summarizeReactions([...rows, row('sam', 'fire', '2026-11-06T12:00:00Z', 'Sam')], 'me').find((r) => r.key === 'fire')!;
    expect(fire.names).toEqual(['Sam', 'Kim', 'Me Myself']);
    expect(fire.userIds).toEqual(['sam', 'kim', 'me']);
    expect(fire.count).toBe(3);
  });

  it('is empty with no reactions, and ignores unknown keys', () => {
    expect(summarizeReactions([], 'me')).toEqual([]);
    expect(summarizeReactions([{ userId: 'x', reaction: 'like' as never, createdAt: '2026-11-06T10:00:00Z', name: 'X' }], 'me')).toEqual([]);
  });

  it('marks nothing as mine for a viewer who did not react', () => {
    expect(summarizeReactions(rows, 'kim').map((r) => r.mine)).toEqual([false, true]);
  });
});

describe('toggleReaction', () => {
  const rows = [row('me', 'fire', '2026-11-06T09:00:00Z', 'Me'), row('kim', 'fire', '2026-11-06T10:00:00Z', 'Kim')];

  it('adds a reaction I do not have, as the newest', () => {
    const next = toggleReaction(rows, { userId: 'me', name: 'Me' }, 'party', '2026-11-06T13:00:00Z');
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual(row('me', 'party', '2026-11-06T13:00:00Z', 'Me'));
    expect(rows).toHaveLength(2);
  });

  it('removes one I already have (tapping the same one again)', () => {
    const next = toggleReaction(rows, { userId: 'me', name: 'Me' }, 'fire', '2026-11-06T13:00:00Z');
    expect(next).toEqual([row('kim', 'fire', '2026-11-06T10:00:00Z', 'Kim')]);
  });

  it('allows several different reactions from one person', () => {
    let next = toggleReaction([], { userId: 'me', name: 'Me' }, 'heart', '2026-11-06T13:00:00Z');
    next = toggleReaction(next, { userId: 'me', name: 'Me' }, 'clap', '2026-11-06T13:00:01Z');
    expect(summarizeReactions(next, 'me').map((r) => r.key)).toEqual(['heart', 'clap']);
  });
});

describe('labels', () => {
  it('words the reaction button for screen readers', () => {
    const [heart, fire] = summarizeReactions(
      [row('me', 'heart', '2026-11-06T09:00:00Z'), row('kim', 'fire', '2026-11-06T10:00:00Z'), row('sam', 'fire', '2026-11-06T11:00:00Z'), row('lee', 'fire', '2026-11-06T12:00:00Z')],
      'me',
    );
    expect(reactionButtonLabel(fire!)).toBe('React with fire, 3 people');
    expect(reactionButtonLabel(heart!)).toBe('Remove your heart reaction, 1 person');
  });

  it('words the who-reacted button', () => {
    const [fire] = summarizeReactions([row('kim', 'fire', '2026-11-06T10:00:00Z', 'Kim')], 'me');
    expect(whoReactedLabel(fire!)).toBe('See who reacted with fire');
  });

  it('groups reaction notifications the way likes were worded', () => {
    expect(groupedReactionText(['Sam'])).toBe('Sam reacted to your post');
    expect(groupedReactionText(['Sam', 'Kim'])).toBe('Sam and Kim reacted to your post');
    expect(groupedReactionText(['Sam', 'Kim', 'Lee', 'Max', 'Ana'])).toBe('Sam and 4 others reacted to your post');
    expect(groupedReactionText(['Sam'], 2)).toBe('Sam and 1 other reacted to your post');
    expect(groupedReactionText([], 0)).toBe('Someone reacted to your post');
    expect(groupedReactionText(['Sam'], 1, 'your comment')).toBe('Sam reacted to your comment');
  });
});
