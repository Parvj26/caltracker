import { describe, expect, it } from 'vitest';
import { COACH_REVEAL_DAYS, coachRevealCandidates, parseRevealedIds, withRevealed, type CoachLoggedLog } from './coach-reveal-logic';

const me = 'client-1';
const now = Date.parse('2026-11-07T12:00:00.000Z');
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const row = (over: Partial<CoachLoggedLog>): CoachLoggedLog => ({
  id: 'log-1',
  status: 'completed',
  loggedBy: 'coach-1',
  finishedAt: daysAgo(1),
  ...over,
});

describe('coachRevealCandidates', () => {
  it('picks the client’s coach-finished logs not yet revealed here, oldest first', () => {
    const logs = [row({ id: 'b', finishedAt: daysAgo(1) }), row({ id: 'a', finishedAt: daysAgo(3) })];
    expect(coachRevealCandidates(logs, me, new Set(), now)).toEqual(['a', 'b']);
  });
  it('skips logs already revealed on this phone', () => {
    expect(coachRevealCandidates([row({ id: 'a' }), row({ id: 'b' })], me, new Set(['a']), now)).toEqual(['b']);
  });
  it('skips logs the client logged, unknown loggers, and ones not completed', () => {
    const logs = [
      row({ id: 'mine', loggedBy: me }),
      row({ id: 'nobody', loggedBy: null }),
      row({ id: 'open', status: 'in_progress' }),
      row({ id: 'gone', status: 'discarded' }),
      row({ id: 'nofinish', finishedAt: null }),
    ];
    expect(coachRevealCandidates(logs, me, new Set(), now)).toEqual([]);
  });
  it(`only looks back ${COACH_REVEAL_DAYS} days`, () => {
    const logs = [row({ id: 'old', finishedAt: daysAgo(COACH_REVEAL_DAYS + 1) }), row({ id: 'edge', finishedAt: daysAgo(COACH_REVEAL_DAYS - 0.5) })];
    expect(coachRevealCandidates(logs, me, new Set(), now)).toEqual(['edge']);
  });
  it('ignores a finish time it can’t read', () => {
    expect(coachRevealCandidates([row({ finishedAt: 'bad' })], me, new Set(), now)).toEqual([]);
  });
});

describe('revealed ids on this phone', () => {
  it('reads what was stored, and nothing from junk', () => {
    expect(parseRevealedIds(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseRevealedIds(null)).toEqual([]);
    expect(parseRevealedIds('not json')).toEqual([]);
    expect(parseRevealedIds(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRevealedIds(JSON.stringify(['a', 3, null]))).toEqual(['a']);
  });
  it('adds an id once, and keeps the list short (newest kept)', () => {
    expect(withRevealed(['a'], 'a')).toEqual(['a']);
    expect(withRevealed(['a'], 'b')).toEqual(['a', 'b']);
    const many = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    const next = withRevealed(many, 'new');
    expect(next).toHaveLength(200);
    expect(next[next.length - 1]).toBe('new');
    expect(next).not.toContain('id-0');
  });
});
