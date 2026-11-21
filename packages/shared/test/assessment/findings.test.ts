import { describe, expect, it } from 'vitest';
import { checkpointLabelMap, findingChips, observedFindings } from '../../src/assessment/findings';
import { BUILTIN_TESTS } from '../../src/assessment/library';
import type { CheckpointResult, TestDefinition } from '../../src/assessment/types';

const test = (key: string): TestDefinition => {
  const t = BUILTIN_TESTS.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return t;
};
const r = (checkpointId: string, side: CheckpointResult['side'], severity: CheckpointResult['severity']): CheckpointResult => ({ checkpointId, side, severity });

describe('checkpointLabelMap', () => {
  it('names the test when two tests have the same words, and only then', () => {
    const labels = checkpointLabelMap([test('overhead_squat'), test('single_leg_squat')]);
    expect(labels['ohs.knee_valgus']).toBe('Knees cave in · Overhead squat');
    expect(labels['sls.knee_valgus']).toBe('Knee caves in · Single-leg squat');
    expect(labels['ohs.heel_rise']).toBe('Heels lift');
    expect(checkpointLabelMap([test('overhead_squat')])['ohs.knee_valgus']).toBe('Knees cave in');
  });

  it('the built-in library: every label is unique once disambiguated', () => {
    const labels = Object.values(checkpointLabelMap(BUILTIN_TESTS));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('observedFindings uses the same words', () => {
    const findings = observedFindings([
      { definition: test('overhead_squat'), status: 'done', results: [r('ohs.knee_valgus', 'L', 'slight')] },
      { definition: test('single_leg_squat'), status: 'done', results: [r('sls.knee_valgus', 'L', 'severe')] },
    ]);
    expect(findings.map((f) => f.label)).toEqual(['Knee caves in · Single-leg squat', 'Knees cave in · Overhead squat']);
  });
});

describe('observedFindings', () => {
  it('lists only Slight and Severe lines, worst first, posture last', () => {
    const findings = observedFindings([
      {
        definition: test('overhead_squat'),
        status: 'done',
        results: [r('ohs.heel_rise', 'L', 'slight'), r('ohs.heel_rise', 'R', 'slight'), r('ohs.knee_valgus', 'L', 'severe'), r('ohs.knee_valgus', 'R', 'slight'), r('ohs.feet_turn_out', 'L', 'normal')],
      },
      { definition: test('static_posture'), status: 'done', results: [r('posture.head_forward', 'none', 'severe')] },
      { definition: test('shoulder_mobility'), status: 'done', results: [r('shm.shoulder_hike', 'L', 'slight')] },
    ]);
    expect(findings.map((f) => f.label)).toEqual(['Knees cave in', 'Heels lift', 'Shoulder hikes up', 'Head forward · posture']);
    expect(findings[0]?.worst).toBe('severe');
  });

  it('shows nothing from skipped tests, but keeps what a stopped test recorded', () => {
    const findings = observedFindings([
      { definition: test('push_up'), status: 'skipped', results: [r('pu.lumbar_sag', 'none', 'severe')] },
      { definition: test('single_leg_squat'), status: 'stopped', results: [r('sls.knee_valgus', 'R', 'severe')] },
    ]);
    expect(findings.map((f) => f.checkpointId)).toEqual(['sls.knee_valgus']);
  });

  it('ignores a side that does not fit the checkpoint', () => {
    expect(observedFindings([{ definition: test('push_up'), status: 'done', results: [r('pu.lumbar_sag', 'L', 'severe')] }])).toEqual([]);
  });
});

describe('findingChips', () => {
  it('joins matching sides, splits different ones, and leaves unsided ones bare', () => {
    expect(findingChips({ sides: [{ side: 'L', severity: 'slight' }, { side: 'R', severity: 'slight' }] })).toEqual([{ text: 'L R · Slight', severity: 'slight' }]);
    expect(findingChips({ sides: [{ side: 'L', severity: 'severe' }, { side: 'R', severity: 'slight' }] }).map((c) => c.text)).toEqual(['L · Severe', 'R · Slight']);
    expect(findingChips({ sides: [{ side: 'L', severity: 'slight' }] }).map((c) => c.text)).toEqual(['L · Slight']);
    expect(findingChips({ sides: [{ side: 'none', severity: 'severe' }] }).map((c) => c.text)).toEqual(['Severe']);
  });
});
