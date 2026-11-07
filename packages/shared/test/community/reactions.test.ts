import { describe, expect, it } from 'vitest';
import {
  REACTIONS,
  applyReactionChange,
  groupedReactionText,
  invertReactionChange,
  isReactionKey,
  reactionButtonLabel,
  reactionTap,
  topReactionsLine,
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

describe('per-tap changes (for undoing one failed tap)', () => {
  const me = { userId: 'me', name: 'Me' };

  it('describes a tap as an add or a remove of one row', () => {
    const rows = [row('me', 'fire', '2026-11-06T09:00:00Z', 'Me')];
    expect(reactionTap(rows, me, 'heart', '2026-11-06T13:00:00Z')).toEqual({ op: 'add', row: row('me', 'heart', '2026-11-06T13:00:00Z', 'Me') });
    expect(reactionTap(rows, me, 'fire', '2026-11-06T13:00:00Z')).toEqual({ op: 'remove', row: rows[0] });
  });

  it('applies a change without duplicating or touching other rows', () => {
    const rows = [row('kim', 'fire', '2026-11-06T10:00:00Z', 'Kim')];
    const add = { op: 'add' as const, row: row('me', 'fire', '2026-11-06T13:00:00Z', 'Me') };
    expect(applyReactionChange(applyReactionChange(rows, add), add)).toEqual([...rows, add.row]);
    expect(applyReactionChange(rows, { op: 'remove', row: add.row })).toEqual(rows);
  });

  it('undoes only the failed tap, keeping a later tap that succeeded', () => {
    let rows: ReactionRow[] = [row('me', 'fire', '2026-11-06T09:00:00Z', 'Me'), row('kim', 'clap', '2026-11-06T10:00:00Z', 'Kim')];
    const first = reactionTap(rows, me, 'party', '2026-11-06T13:00:00Z'); // add party: will fail
    rows = applyReactionChange(rows, first);
    const second = reactionTap(rows, me, 'fire', '2026-11-06T13:00:01Z'); // remove fire: succeeds
    rows = applyReactionChange(rows, second);
    rows = applyReactionChange(rows, invertReactionChange(first));
    expect(summarizeReactions(rows, 'me').map((r) => [r.key, r.mine])).toEqual([['clap', false]]);
  });

  it('puts a failed remove back as it was', () => {
    const original = row('me', 'heart', '2026-11-06T09:00:00Z', 'Me');
    let rows: ReactionRow[] = [original];
    const tap = reactionTap(rows, me, 'heart', '2026-11-06T13:00:00Z');
    rows = applyReactionChange(rows, tap);
    rows = applyReactionChange(rows, reactionTap(rows, me, 'muscle', '2026-11-06T13:00:01Z'));
    rows = applyReactionChange(rows, invertReactionChange(tap));
    expect(rows).toContainEqual(original);
    expect(summarizeReactions(rows, 'me').map((r) => r.key)).toEqual(['heart', 'muscle']);
  });
});

describe('topReactionsLine', () => {
  it('lists the most used reactions with counts, ties in the fixed order', () => {
    const rows = [
      row('a', 'fire', '2026-11-06T10:00:00Z'),
      row('b', 'heart', '2026-11-06T10:00:00Z'),
      row('c', 'heart', '2026-11-06T10:00:00Z'),
      row('d', 'party', '2026-11-06T10:00:00Z'),
      row('e', 'muscle', '2026-11-06T10:00:00Z'),
    ];
    expect(topReactionsLine(rows)).toBe('❤️ 2 · 💪 1 · 🔥 1');
    expect(topReactionsLine(rows, 1)).toBe('❤️ 2');
    expect(topReactionsLine(rows, 6)).toBe('❤️ 2 · 💪 1 · 🔥 1 · 🎉 1');
  });

  it('is empty with no reactions', () => {
    expect(topReactionsLine([])).toBe('');
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
