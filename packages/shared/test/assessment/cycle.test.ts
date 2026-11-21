import { describe, expect, it } from 'vitest';
import { canStart, cycleView, type AssessmentSummary, type CycleSummary } from '../../src/assessment/cycle';

const a = (slot: AssessmentSummary['slot'], status: AssessmentSummary['status'], assessedOn = '2026-11-03', score: number | null = 68): AssessmentSummary => ({
  id: `${slot}-${status}`,
  slot,
  status,
  assessedOn,
  score: status === 'done' ? score : null,
});
const cycle = (number: number, ...assessments: AssessmentSummary[]): CycleSummary => ({ id: `c${number}`, number, assessments });

describe('cycleView', () => {
  it('first time: Cycle 1, Initial due now, both retests waiting, no new cycle', () => {
    const v = cycleView([]);
    expect(v.number).toBe(1);
    expect(v.current).toBeNull();
    expect(v.slots).toEqual([
      { slot: 'initial', state: 'due', dueOn: null },
      { slot: 'retest_1', state: 'waiting' },
      { slot: 'retest_2', state: 'waiting' },
    ]);
    expect(v.canStartNewCycle).toBe(false);
    expect(v.latestDone).toBeNull();
    expect(canStart(v, 'initial', true)).toBe(true);
    expect(canStart(v, 'retest_1', false)).toBe(false);
  });

  it('a draft Initial is resumable and nothing else can start', () => {
    const v = cycleView([cycle(1, a('initial', 'draft'))]);
    expect(v.slots[0]?.state).toBe('draft');
    expect(v.slots[1]?.state).toBe('waiting');
    expect(canStart(v, 'initial', false)).toBe(false);
    expect(canStart(v, 'initial', true)).toBe(false);
  });

  it('Initial done: Retest 1 due four weeks later', () => {
    const v = cycleView([cycle(1, a('initial', 'done', '2026-11-03'))]);
    expect(v.slots[0]).toMatchObject({ state: 'done', assessment: { score: 68 } });
    expect(v.slots[1]).toEqual({ slot: 'retest_1', state: 'due', dueOn: '2026-12-01' });
    expect(v.slots[2]?.state).toBe('waiting');
    expect(v.latestDone?.slot).toBe('initial');
    expect(canStart(v, 'retest_1', false)).toBe(true);
    expect(v.canStartNewCycle).toBe(false);
  });

  it('Retest 1 done: Retest 2 optional and a new cycle may start', () => {
    const v = cycleView([cycle(1, a('initial', 'done'), a('retest_1', 'done', '2026-12-01', 85))]);
    expect(v.slots[2]).toEqual({ slot: 'retest_2', state: 'optional' });
    expect(v.canStartNewCycle).toBe(true);
    expect(v.latestDone?.slot).toBe('retest_1');
    expect(canStart(v, 'retest_2', false)).toBe(true);
    expect(canStart(v, 'initial', true)).toBe(true);
    expect(canStart(v, 'initial', false)).toBe(false);
  });

  it('a Retest 2 in progress holds back a new cycle', () => {
    const v = cycleView([cycle(1, a('initial', 'done'), a('retest_1', 'done'), a('retest_2', 'draft'))]);
    expect(v.canStartNewCycle).toBe(false);
  });

  it('shows the newest cycle and keeps older ones as past, newest first', () => {
    const v = cycleView([
      cycle(1, a('initial', 'done'), a('retest_1', 'done')),
      cycle(3),
      cycle(2, a('initial', 'done'), a('retest_1', 'done')),
    ]);
    expect(v.number).toBe(3);
    expect(v.slots[0]).toEqual({ slot: 'initial', state: 'due', dueOn: null });
    expect(v.past.map((c) => c.number)).toEqual([2, 1]);
  });
});
