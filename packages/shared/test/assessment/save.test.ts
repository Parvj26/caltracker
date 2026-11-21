import { describe, expect, it } from 'vitest';
import { BUILTIN_TESTS } from '../../src/assessment/library';
import { checkTestEntry, emptyEntry, followUpShown } from '../../src/assessment/save';
import type { TestDefinition } from '../../src/assessment/types';

const test = (key: string): TestDefinition => {
  const t = BUILTIN_TESTS.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return t;
};
const ohs = test('overhead_squat');
const shm = test('shoulder_mobility');
const pu = test('push_up');

describe('checkTestEntry', () => {
  it('fills the full grid with Normal where untouched', () => {
    const e = checkTestEntry(ohs, { ...emptyEntry(), status: 'done', results: [{ checkpointId: 'ohs.knee_valgus', side: 'L', severity: 'severe' }] });
    expect(e).not.toBeNull();
    // Every checkpoint of the definition, per side.
    const lines = ohs.views.flatMap((v) => v.groups.flatMap((g) => g.checkpoints)).reduce((n, c) => n + (c.sided ? 2 : 1), 0);
    expect(e?.results).toHaveLength(lines);
    expect(e?.results.find((r) => r.checkpointId === 'ohs.knee_valgus' && r.side === 'L')?.severity).toBe('severe');
    expect(e?.results.find((r) => r.checkpointId === 'ohs.knee_valgus' && r.side === 'R')?.severity).toBe('normal');
    expect(e?.results.find((r) => r.checkpointId === 'ohs.forward_lean')?.side).toBe('none');
  });

  it('refuses unknown checkpoints, wrong sides and unknown severities', () => {
    const bad = [
      { checkpointId: 'ohs.nope', side: 'L', severity: 'slight' },
      { checkpointId: 'ohs.forward_lean', side: 'L', severity: 'slight' },
      { checkpointId: 'ohs.knee_valgus', side: 'none', severity: 'slight' },
      { checkpointId: 'ohs.knee_valgus', side: 'L', severity: 'marked' },
    ];
    for (const r of bad) expect(checkTestEntry(ohs, { ...emptyEntry(), results: [r] })).toBeNull();
  });

  it('keeps measures in range per side and refuses the rest', () => {
    const ok = checkTestEntry(shm, { ...emptyEntry(), measures: [{ measureId: 'shm.reach_gap', side: 'L', value: 14.25 }] });
    expect(ok?.measures).toEqual([{ measureId: 'shm.reach_gap', side: 'L', value: 14.3 }]);
    expect(checkTestEntry(shm, { ...emptyEntry(), measures: [{ measureId: 'shm.reach_gap', side: 'L', value: 61 }] })).toBeNull();
    expect(checkTestEntry(shm, { ...emptyEntry(), measures: [{ measureId: 'shm.reach_gap', side: 'none', value: 3 }] })).toBeNull();
    expect(checkTestEntry(shm, { ...emptyEntry(), measures: [{ measureId: 'shm.reach_gap', side: 'L', value: Number.NaN }] })).toBeNull();
  });

  it('keeps a follow-up answer only while its checkpoint is not Normal', () => {
    const heels = [{ checkpointId: 'ohs.heel_rise', side: 'L', severity: 'slight' }];
    expect(checkTestEntry(ohs, { ...emptyEntry(), results: heels, followUps: { 'ohs.heel_lift_retest': 'better' } })?.followUps).toEqual({ 'ohs.heel_lift_retest': 'better' });
    expect(checkTestEntry(ohs, { ...emptyEntry(), followUps: { 'ohs.heel_lift_retest': 'better' } })?.followUps).toEqual({});
    expect(checkTestEntry(ohs, { ...emptyEntry(), results: heels, followUps: { 'ohs.heel_lift_retest': 'worse' } })).toBeNull();
    expect(followUpShown(ohs, 'ohs.heel_lift_retest', [{ checkpointId: 'ohs.heel_rise', side: 'R', severity: 'severe' }])).toBe(true);
    expect(followUpShown(ohs, 'ohs.heel_lift_retest', [])).toBe(false);
  });

  it('takes "Type done" only on tests that have it, and limits text lengths', () => {
    expect(checkTestEntry(pu, { ...emptyEntry(), typeDone: ' Incline, hands on bench ' })?.typeDone).toBe('Incline, hands on bench');
    expect(checkTestEntry(ohs, { ...emptyEntry(), typeDone: 'Floor' })).toBeNull();
    expect(checkTestEntry(pu, { ...emptyEntry(), typeDone: 'x'.repeat(121) })).toBeNull();
    expect(checkTestEntry(pu, { ...emptyEntry(), note: 'x'.repeat(1001) })).toBeNull();
  });

  it('refuses anything that is not an entry', () => {
    expect(checkTestEntry(ohs, null)).toBeNull();
    expect(checkTestEntry(ohs, { ...emptyEntry(), status: 'finished' })).toBeNull();
    expect(checkTestEntry(ohs, { ...emptyEntry(), discomfortLeft: 'yes' })).toBeNull();
  });
});
