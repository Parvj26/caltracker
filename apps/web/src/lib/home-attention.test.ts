import { describe, expect, it } from 'vitest';
import { attentionGroups, type ClientCheck } from '@caltracker/shared';
import { attentionCounts, attentionEntries, attentionRows, dayWord, fixFor, reasonLine, type HomeReason } from './home-attention';

// Saturday 7 November 2026.
const TODAY = '2026-11-07';

const check = (clientId: string, reasons: ClientCheck['reasons']): ClientCheck => ({
  clientId,
  reasons,
  status: 'needs_attention',
  lastWorkoutOn: null,
  week: { done: 0, planned: 0 },
  program: null,
});

describe('attentionEntries', () => {
  const groups = attentionGroups([
    check('ana', [{ kind: 'nothing_planned' }]),
    check('jordan', [{ kind: 'missed', count: 2, lastMissedOn: '2026-11-05' }, { kind: 'program_ending', assignmentId: 'a', endDate: '2026-11-13', daysLeft: 6 }]),
    check('leo', [{ kind: 'program_ending', assignmentId: 'b', endDate: '2026-11-09', daysLeft: 2 }]),
    check('mia', [{ kind: 'missed_in_a_row', count: 3, lastMissedOn: '2026-11-06' }]),
    check('sam', [{ kind: 'new_bests', count: 2 }]),
    check('quinn', [{ kind: 'quiet', days: 8, atLeast: false }]),
  ]);
  const entries = attentionEntries(groups, [
    { clientId: 'ana', lastScanOn: '2026-10-04' },
    { clientId: 'zoe', lastScanOn: null },
  ]);

  it('lists each client once, most urgent first, scans-only last, and leaves out new bests', () => {
    expect(entries.map((e) => e.clientId)).toEqual(['mia', 'jordan', 'leo', 'ana', 'quinn', 'zoe']);
    expect(entries.find((e) => e.clientId === 'sam')).toBeUndefined();
  });

  it("keeps a client's reasons in urgency order", () => {
    expect(entries.find((e) => e.clientId === 'jordan')!.reasons.map((r) => r.kind)).toEqual(['missed', 'program_ending']);
    expect(entries.find((e) => e.clientId === 'ana')!.reasons.map((r) => r.kind)).toEqual(['nothing_planned', 'scan_due']);
  });

  it('counts clients per chip, a client under every chip they belong to', () => {
    expect(attentionCounts(entries)).toEqual({ all: 6, missed: 2, plan: 2, scan: 2 });
  });

  it('shows the most urgent reason plus how many more, or the filtered reason when a chip is on', () => {
    const all = attentionRows(entries, 'all');
    expect(all.find((r) => r.clientId === 'jordan')).toMatchObject({ reason: { kind: 'missed' }, more: 1 });
    const plan = attentionRows(entries, 'plan');
    expect(plan.map((r) => r.clientId)).toEqual(['jordan', 'leo']);
    expect(plan[0]).toMatchObject({ reason: { kind: 'program_ending' }, more: 1 });
    const scan = attentionRows(entries, 'scan');
    expect(scan.map((r) => [r.clientId, r.more])).toEqual([['ana', 1], ['zoe', 0]]);
  });

  it('never calls a client quiet while they are training right now', () => {
    const quiet = attentionGroups([check('quinn', [{ kind: 'quiet', days: 8, atLeast: false }])]);
    expect(attentionEntries(quiet, [], new Set(['quinn']))).toEqual([]);
    expect(attentionEntries(quiet, [{ clientId: 'quinn', lastScanOn: null }], new Set(['quinn']))[0]!.reasons.map((r) => r.kind)).toEqual(['scan_due']);
  });

  it('is empty when nobody needs anything', () => {
    const none = attentionEntries(attentionGroups([check('sam', [{ kind: 'new_bests', count: 1 }])]), []);
    expect(none).toEqual([]);
    expect(attentionCounts(none)).toEqual({ all: 0, missed: 0, plan: 0, scan: 0 });
  });
});

describe('dayWord', () => {
  it('names nearby days plainly', () => {
    expect(dayWord(TODAY, TODAY)).toBe('today');
    expect(dayWord('2026-11-06', TODAY)).toBe('yesterday');
    expect(dayWord('2026-11-08', TODAY)).toBe('tomorrow');
    expect(dayWord('2026-11-05', TODAY)).toBe('Thursday');
    expect(dayWord('2026-11-13', TODAY)).toBe('Friday');
    expect(dayWord('2026-10-31', TODAY)).toBe('last Saturday');
    expect(dayWord('2026-11-14', TODAY)).toBe('next Saturday');
  });
});

describe('reasonLine and fixFor', () => {
  const cases: [HomeReason, string, string, string][] = [
    [{ kind: 'missed', count: 1, lastMissedOn: '2026-11-05' }, 'Missed Thursday', 'Message', '/messages/c'],
    [{ kind: 'missed', count: 2, lastMissedOn: '2026-11-05' }, 'Missed 2 workouts in the last 7 days', 'Message', '/messages/c'],
    [{ kind: 'missed_in_a_row', count: 3, lastMissedOn: '2026-11-06' }, 'Missed 3 workouts in a row', 'Message', '/messages/c'],
    [{ kind: 'program_ending', assignmentId: 'a', endDate: '2026-11-13', daysLeft: 6 }, 'Program ends Friday · nothing after', 'Assign', '/clients/c/training'],
    [{ kind: 'program_ending', assignmentId: 'a', endDate: TODAY, daysLeft: 0 }, 'Program ends today · nothing after', 'Assign', '/clients/c/training'],
    [{ kind: 'nothing_planned' }, 'Nothing planned in the next 7 days', 'Assign', '/clients/c/training'],
    [{ kind: 'quiet', days: 8, atLeast: false }, 'No workout in 8 days', 'Message', '/messages/c'],
    [{ kind: 'quiet', days: 30, atLeast: true }, 'No workout in 30+ days', 'Message', '/messages/c'],
    [{ kind: 'scan_due', lastScanOn: '2026-10-04' }, 'Last body scan 34 days ago', 'Add scan', '/clients/c/body?scan=1'],
    [{ kind: 'scan_due', lastScanOn: null }, 'No body scan yet', 'Add scan', '/clients/c/body?scan=1'],
  ];
  it.each(cases)('%j says "%s" and offers %s', (reason, line, label, href) => {
    expect(reasonLine(reason, TODAY)).toBe(line);
    expect(fixFor(reason, 'c', 'Ana Ruiz')).toMatchObject({ label, href });
  });

  it('labels each fix with the client', () => {
    expect(fixFor({ kind: 'nothing_planned' }, 'c', 'Ana Ruiz').ariaLabel).toBe('Assign to Ana Ruiz');
    expect(fixFor({ kind: 'quiet', days: 6, atLeast: false }, 'c', 'Ana Ruiz').ariaLabel).toBe('Message Ana Ruiz');
    expect(fixFor({ kind: 'scan_due', lastScanOn: null }, 'c', 'Ana Ruiz').ariaLabel).toBe('Add a scan for Ana Ruiz');
  });
});
