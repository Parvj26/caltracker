import { describe, expect, it } from 'vitest';
import {
  compareAssessments,
  findingChange,
  formatMeasureDelta,
  formatScoreDelta,
  measureChange,
  orderColumnPicks,
  type CompareAssessment,
  type CompareMeasure,
  type CompareTest,
} from '../../src/assessment/compare';
import { BUILTIN_TESTS } from '../../src/assessment/library';
import type { CheckpointResult, Severity, Side, TestDefinition, TestStatus } from '../../src/assessment/types';

const lib = (key: string): TestDefinition => {
  const d = BUILTIN_TESTS.find((t) => t.key === key);
  if (!d) throw new Error(key);
  return d;
};
const r = (checkpointId: string, side: Side, severity: Severity): CheckpointResult => ({ checkpointId, side, severity });
const m = (measureId: string, side: Side, value: number, unit: CompareMeasure['unit'] = 'cm', higherIsBetter = false): CompareMeasure => ({
  measureId,
  side,
  value,
  unit,
  higherIsBetter,
});
const test = (key: string, results: CheckpointResult[] = [], measures: CompareMeasure[] = [], status: TestStatus = 'done', definition = lib(key)): CompareTest => ({
  definition,
  status,
  results,
  measures,
});
const assessment = (slot: CompareAssessment['slot'], tests: CompareTest[], score: number | null = null): CompareAssessment => ({
  id: slot,
  slot,
  assessedOn: slot === 'initial' ? '2026-11-03' : '2026-12-01',
  score,
  tests,
});

// The example on boards AS7 and AS12 (as corrected): Initial 68 (squat 67, shoulders 75) → Retest 1 85 (83, 100).
const initial = assessment('initial', [
  test('overhead_squat', [
    r('ohs.knee_valgus', 'L', 'severe'),
    r('ohs.knee_valgus', 'R', 'slight'),
    r('ohs.heel_rise', 'L', 'slight'),
    r('ohs.heel_rise', 'R', 'slight'),
    r('ohs.arms_fall_forward', 'L', 'severe'),
    r('ohs.arms_fall_forward', 'R', 'severe'),
    r('ohs.head_forward', 'none', 'slight'),
  ]),
  test('shoulder_mobility', [r('shm.shoulder_hike', 'L', 'slight')], [m('shm.reach_gap', 'L', 14), m('shm.reach_gap', 'R', 11)]),
  test('static_posture', [r('posture.head_forward', 'none', 'slight')]),
]);
const retest = assessment('retest_1', [
  test('overhead_squat', [
    r('ohs.knee_valgus', 'L', 'slight'),
    r('ohs.arms_fall_forward', 'L', 'slight'),
    r('ohs.arms_fall_forward', 'R', 'slight'),
    r('ohs.head_forward', 'none', 'slight'),
    r('ohs.low_back_arch', 'none', 'slight'),
  ]),
  test('shoulder_mobility', [], [m('shm.reach_gap', 'L', 10), m('shm.reach_gap', 'R', 9)]),
  test('static_posture', [], [], 'skipped'),
]);

describe('compareAssessments: the board example (AS7 / AS12)', () => {
  const c = compareAssessments([initial, retest]);

  it('works the scores out the same way as movementScore: 68 → 85, +17', () => {
    expect(c.overall).toEqual({ values: [68, 85], delta: 17 });
    expect(c.tests.map((t) => [t.name, t.cells.map((x) => x.score), t.delta])).toEqual([
      ['Overhead squat', [67, 83], 16],
      ['Shoulder mobility', [75, 100], 25],
      ['Posture', [null, null], null],
    ]);
    expect(c.tests[2]?.cells.map((x) => x.notScored)).toEqual(['record_only', 'skipped']);
  });

  it('joins findings on checkpoint and side: 5 improved, 1 same, 1 new, 0 worse, posture not tested', () => {
    expect(c.findings.map((f) => [f.label, f.side, f.values, f.change])).toEqual([
      ['Heels lift', 'LR', ['slight', 'normal'], 'improved'],
      ['Knees cave in', 'L', ['severe', 'slight'], 'improved'],
      ['Knees cave in', 'R', ['slight', 'normal'], 'improved'],
      ['Low back arches', 'none', ['normal', 'slight'], 'new'],
      ['Arms fall forward', 'LR', ['severe', 'slight'], 'improved'],
      ['Head pokes forward', 'none', ['slight', 'slight'], 'same'],
      ['Shoulder hikes up', 'L', ['slight', 'normal'], 'improved'],
      ['Head forward · posture', 'none', ['slight', 'not_tested'], 'not_tested'],
    ]);
    expect(c.findingCounts).toEqual({ improved: 5, same: 1, new: 1, worse: 0 });
  });

  it('reads measurements with their unit and direction: a smaller gap is better', () => {
    expect(c.measures.map((x) => [x.measureId, x.side, x.values, x.delta, x.change])).toEqual([
      ['shm.reach_gap', 'L', [14, 10], -4, 'improved'],
      ['shm.reach_gap', 'R', [11, 9], -2, 'improved'],
    ]);
    expect(c.measureCounts).toEqual({ improved: 2, same: 0, worse: 0 });
  });

  it('prefers the stored overall score', () => {
    expect(compareAssessments([{ ...initial, score: 70 }, retest]).overall).toEqual({ values: [70, 85], delta: 15 });
  });
});

describe('compareAssessments: three columns', () => {
  it('compares the first column with the last, keeping the middle one', () => {
    const retest2 = assessment('retest_2', [test('overhead_squat', [r('ohs.knee_valgus', 'L', 'severe'), r('ohs.knee_valgus', 'R', 'severe')])]);
    const c = compareAssessments([initial, retest, retest2]);
    const knees = c.findings.filter((f) => f.checkpointId === 'ohs.knee_valgus');
    expect(knees.map((f) => [f.side, f.values, f.change])).toEqual([
      ['L', ['severe', 'slight', 'severe'], 'same'],
      ['R', ['slight', 'normal', 'severe'], 'worse'],
    ]);
    // Shoulder mobility isn't in Retest 2: not tested there.
    expect(c.tests.find((t) => t.key === 'shoulder_mobility')?.cells.map((x) => x.notScored)).toEqual([null, null, 'not_in_assessment']);
    expect(c.measures[0]?.values).toEqual([14, 10, null]);
    expect(c.measures[0]?.change).toBe('not_tested');
    expect(c.overall.values).toHaveLength(3);
  });
});

describe('compareAssessments: edge cases', () => {
  it('a skipped test is not tested, never Normal', () => {
    const later = assessment('retest_1', [test('overhead_squat', [], [], 'skipped')]);
    const c = compareAssessments([initial, later]);
    expect(c.findings.every((f) => f.change === 'not_tested' || f.checkpointId.startsWith('shm'))).toBe(true);
    expect(c.findingCounts).toEqual({ improved: 0, same: 0, new: 0, worse: 0 });
  });

  it('a stopped test keeps what it saw, and lines it never reached are not tested', () => {
    const later = assessment('retest_1', [test('overhead_squat', [r('ohs.knee_valgus', 'L', 'slight'), r('ohs.heel_rise', 'L', 'normal')], [], 'stopped')]);
    const c = compareAssessments([initial, later]);
    expect(c.findings.find((f) => f.checkpointId === 'ohs.knee_valgus' && f.side === 'L')?.change).toBe('improved');
    expect(c.findings.find((f) => f.checkpointId === 'ohs.heel_rise')?.values).toEqual(['slight', 'not_tested']);
  });

  it('lines up a newer version of a test by checkpoint id; a checkpoint the old version lacked is not tested there', () => {
    const v1 = lib('shoulder_mobility');
    const v2: TestDefinition = {
      ...v1,
      version: 2,
      name: 'Shoulder mobility (v2)',
      views: [{ ...v1.views[0]!, groups: [{ label: 'Also seen', checkpoints: [...v1.views[0]!.groups[0]!.checkpoints, { id: 'shm.elbow_flare', label: 'Elbow flares', sided: true }] }] }],
    };
    const a = assessment('initial', [test('shoulder_mobility', [r('shm.shoulder_hike', 'R', 'severe')], [], 'done', v1)]);
    const b = assessment('retest_1', [test('shoulder_mobility', [r('shm.shoulder_hike', 'R', 'slight'), r('shm.elbow_flare', 'L', 'slight')], [], 'done', v2)]);
    const c = compareAssessments([a, b]);
    expect(c.findings.map((f) => [f.checkpointId, f.side, f.values, f.change])).toEqual([
      ['shm.shoulder_hike', 'R', ['severe', 'slight'], 'improved'],
      ['shm.elbow_flare', 'L', ['not_tested', 'slight'], 'not_tested'],
    ]);
    expect(c.tests[0]?.name).toBe('Shoulder mobility (v2)');
  });

  it('takes a measure\'s label from the newest version, like findings', () => {
    const v1 = lib('shoulder_mobility');
    const v2: TestDefinition = { ...v1, version: 2, measures: [{ ...v1.measures[0]!, label: 'Reach gap' }] };
    const a = assessment('initial', [test('shoulder_mobility', [], [m('shm.reach_gap', 'L', 14)], 'done', v1)]);
    const b = assessment('retest_1', [test('shoulder_mobility', [], [m('shm.reach_gap', 'L', 10)], 'done', v2)]);
    expect(compareAssessments([a, b]).measures.map((x) => x.label)).toEqual(['Reach gap']);
  });

  it('uses higher-is-better for angles and times, and refuses to compare different units', () => {
    const a = assessment('initial', [test('active_straight_leg_raise', [], [m('aslr.angle', 'L', 60, 'deg', true), m('aslr.angle', 'R', 70, 'deg', true)])]);
    const b = assessment('retest_1', [test('active_straight_leg_raise', [], [m('aslr.angle', 'L', 70, 'deg', true), m('aslr.angle', 'R', 70, 'cm', true)])]);
    const c = compareAssessments([a, b]);
    expect(c.measures.map((x) => [x.side, x.delta, x.change])).toEqual([
      ['L', 10, 'improved'],
      ['R', null, 'not_tested'],
    ]);
  });

  it('leaves out lines that were Normal everywhere', () => {
    const a = assessment('initial', [test('overhead_squat')]);
    const b = assessment('retest_1', [test('overhead_squat')]);
    const c = compareAssessments([a, b]);
    expect(c.findings).toEqual([]);
    expect(c.overall).toEqual({ values: [100, 100], delta: 0 });
  });
});

describe('orderColumnPicks (phone: two boxes)', () => {
  it('always reads earlier → later, whichever box picked which', () => {
    expect(orderColumnPicks([1, 0])).toEqual([0, 1]);
    expect(orderColumnPicks([2, 0])).toEqual([0, 2]);
    expect(orderColumnPicks([0, 2])).toEqual([0, 2]);
    // "From Retest 2, with Initial" compares like "from Initial, with Retest 2": improvements stay improvements.
    const r2 = assessment('retest_2', retest.tests);
    const cols = [initial, retest, r2];
    const [a, b] = orderColumnPicks([2, 0]);
    expect(compareAssessments([cols[a]!, cols[b]!]).overall).toEqual({ values: [68, 85], delta: 17 });
  });
});

describe('change helpers', () => {
  it('findingChange', () => {
    expect(findingChange('severe', 'slight')).toBe('improved');
    expect(findingChange('slight', 'normal')).toBe('improved');
    expect(findingChange('slight', 'slight')).toBe('same');
    expect(findingChange('normal', 'slight')).toBe('new');
    expect(findingChange('normal', 'severe')).toBe('new');
    expect(findingChange('slight', 'severe')).toBe('worse');
    expect(findingChange('not_tested', 'slight')).toBe('not_tested');
  });

  it('measureChange rounds away floating-point noise', () => {
    expect(measureChange(0.3, 0.1, false)).toEqual({ delta: -0.2, change: 'improved' });
    expect(measureChange(12, 12, true)).toEqual({ delta: 0, change: 'same' });
    expect(measureChange(30, 20, true)).toEqual({ delta: -10, change: 'worse' });
    expect(measureChange(null, 20, true)).toEqual({ delta: null, change: 'not_tested' });
  });

  it('formats deltas with a true minus sign', () => {
    expect(formatMeasureDelta(-4, 'cm')).toBe('−4 cm');
    expect(formatMeasureDelta(10, 'deg')).toBe('+10°');
    expect(formatMeasureDelta(5, 's')).toBe('+5 s');
    expect(formatScoreDelta(17)).toBe('+17');
    expect(formatScoreDelta(-3)).toBe('−3');
    expect(formatScoreDelta(0)).toBe('0');
  });
});
