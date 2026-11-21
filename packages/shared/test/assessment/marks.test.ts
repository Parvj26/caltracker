import { describe, expect, it } from 'vitest';
import { MUSCLE_IDS } from '../../src/anatomy/muscles';
import { BUILTIN_CORRECTIVES } from '../../src/assessment/correctives';
import { BUILTIN_TESTS } from '../../src/assessment/library';
import {
  alsoChecks,
  alsoConsider,
  checkAlsoCheckIds,
  checkMarks,
  confirmedGroups,
  confirmedMarks,
  markStates,
  reviewGroups,
  reviewRows,
  suggestMarks,
  type StoredMark,
} from '../../src/assessment/marks';
import { observedFindings } from '../../src/assessment/findings';
import { CONTENT_MUSCLE_MAP, FINDING_RULES } from '../../src/assessment/rules';
import type { CheckpointResult, TestDefinition } from '../../src/assessment/types';
import { checkpointsOf } from '../../src/assessment/score';

const test = (key: string): TestDefinition => {
  const t = BUILTIN_TESTS.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return t;
};
const r = (checkpointId: string, side: CheckpointResult['side'], severity: CheckpointResult['severity']): CheckpointResult => ({ checkpointId, side, severity });

describe('FINDING_RULES', () => {
  const allCheckpoints = BUILTIN_TESTS.flatMap((t) => checkpointsOf(t).map((c) => ({ id: c.id, recordOnly: t.kind === 'record_only' })));

  it('only names checkpoints that exist in the built-in library', () => {
    const ids = new Set(allCheckpoints.map((c) => c.id));
    for (const id of Object.keys(FINDING_RULES)) expect(ids.has(id), id).toBe(true);
  });

  it('has a rule for every scored checkpoint and none for posture (record-only, linked by hand)', () => {
    for (const c of allCheckpoints) expect(Object.prototype.hasOwnProperty.call(FINDING_RULES, c.id), c.id).toBe(!c.recordOnly);
  });

  it('uses only catalogue muscles and built-in corrective keys, never the same muscle both ways', () => {
    const keys = new Set(BUILTIN_CORRECTIVES.map((b) => b.key));
    for (const [id, rule] of Object.entries(FINDING_RULES)) {
      for (const m of [...rule.over, ...rule.under]) expect(MUSCLE_IDS, `${id} ${m}`).toContain(m);
      expect(rule.over.filter((m) => rule.under.includes(m)), id).toEqual([]);
      for (const k of rule.exercises) expect(keys.has(k), `${id} ${k}`).toBe(true);
    }
  });

  it('maps every evidence-draft muscle to a catalogue muscle or to none', () => {
    for (const [m, to] of Object.entries(CONTENT_MUSCLE_MAP)) if (to !== null) expect(MUSCLE_IDS, m).toContain(to);
    expect(Object.keys(CONTENT_MUSCLE_MAP)).toHaveLength(37);
  });
});

describe('suggestMarks', () => {
  it('maps a sided finding to that side and an unsided one to both sides', () => {
    const s = suggestMarks([
      { definition: test('overhead_squat'), status: 'done', results: [r('ohs.knee_valgus', 'L', 'severe'), r('ohs.forward_lean', 'none', 'slight')] },
    ]);
    const key = (m: { muscleId: string; side: string }) => `${m.muscleId}.${m.side}`;
    expect(s.find((m) => key(m) === 'adductors.L')?.status).toBe('over');
    expect(s.find((m) => key(m) === 'adductors.R')).toBeUndefined();
    expect(s.find((m) => key(m) === 'glute_medius.L')).toMatchObject({ status: 'under', sources: [{ checkpointId: 'ohs.knee_valgus', label: 'Knees cave in' }] });
    // Forward lean (unsided): hip flexors on both sides.
    expect(s.filter((m) => m.muscleId === 'hip_flexors').map((m) => m.side)).toEqual(['L', 'R']);
  });

  it('keeps abs as one region', () => {
    const s = suggestMarks([{ definition: test('push_up'), status: 'done', results: [r('pu.lumbar_sag', 'none', 'slight')] }]);
    expect(s.filter((m) => m.muscleId === 'abs')).toEqual([expect.objectContaining({ side: 'none', status: 'under' })]);
  });

  it('suggests nothing from posture, skipped tests or Normal lines', () => {
    expect(
      suggestMarks([
        { definition: test('static_posture'), status: 'done', results: [r('posture.head_forward', 'none', 'severe')] },
        { definition: test('push_up'), status: 'skipped', results: [r('pu.lumbar_sag', 'none', 'severe')] },
        { definition: test('overhead_squat'), status: 'done', results: [r('ohs.knee_valgus', 'L', 'normal')] },
      ]),
    ).toEqual([]);
  });

  it('settles a disagreement by count, a tie by the worse finding, and keeps the outvoted sources', () => {
    // Forward lean says glute max under, nothing says it over: plain. Low back arch: lower back over; forward lean:
    // lower back under → tie. Low back arch is Severe (listed first), so over wins.
    const s = suggestMarks([
      { definition: test('overhead_squat'), status: 'done', results: [r('ohs.low_back_arch', 'none', 'severe'), r('ohs.forward_lean', 'none', 'slight')] },
    ]);
    const lowBack = s.find((m) => m.muscleId === 'lower_back' && m.side === 'L')!;
    expect(lowBack.status).toBe('over');
    expect(lowBack.against.map((a) => a.checkpointId)).toEqual(['ohs.forward_lean']);
  });

  it('lists a source once even when both sides of one finding point at the same muscle', () => {
    const s = suggestMarks([{ definition: test('overhead_squat'), status: 'done', results: [r('ohs.knee_valgus', 'L', 'severe'), r('ohs.knee_valgus', 'R', 'slight')] }]);
    expect(s.find((m) => m.muscleId === 'tfl' && m.side === 'R')?.sources).toHaveLength(1);
  });
});

describe('review rows and groups', () => {
  const tests = [{ definition: test('overhead_squat'), status: 'done' as const, results: [r('ohs.knee_valgus', 'L', 'severe'), r('ohs.knee_valgus', 'R', 'slight')] }];
  const suggested = suggestMarks(tests);

  it('shows every suggestion as pending until the coach acts', () => {
    const rows = reviewRows(suggested, []);
    expect(rows.every((x) => x.review === 'pending' && x.origin === 'suggested')).toBe(true);
  });

  it('applies stored decisions and adds the coach’s own marks with their source labels', () => {
    const stored: StoredMark[] = [
      { muscleId: 'tfl', side: 'R', status: 'over', review: 'rejected', sources: ['ohs.knee_valgus'] },
      { muscleId: 'glute_medius', side: 'L', status: 'normal', review: 'confirmed', sources: ['ohs.knee_valgus'] },
      { muscleId: 'neck', side: 'L', status: 'over', review: 'confirmed', sources: ['posture.head_forward'] },
    ];
    const rows = reviewRows(suggested, stored, { 'posture.head_forward': 'Head forward · posture' });
    expect(rows.find((x) => x.muscleId === 'tfl' && x.side === 'R')?.review).toBe('rejected');
    expect(rows.find((x) => x.muscleId === 'glute_medius' && x.side === 'L')).toMatchObject({ status: 'normal', review: 'confirmed' });
    expect(rows.at(-1)).toMatchObject({ muscleId: 'neck', origin: 'coach', sources: [{ label: 'Head forward · posture' }] });

    const groups = reviewGroups(rows);
    expect(groups.map((g) => g.status)).toEqual([...groups.map((g) => g.status)].sort((a, b) => ['over', 'under', 'normal'].indexOf(a) - ['over', 'under', 'normal'].indexOf(b)));
    const gm = groups.filter((g) => g.muscleId === 'glute_medius');
    expect(gm.map((g) => [g.status, g.rows.map((x) => x.side)])).toEqual([
      ['under', ['R']],
      ['normal', ['L']],
    ]);
    expect(groups.find((g) => g.muscleId === 'adductors')?.rows.map((x) => x.side)).toEqual(['L', 'R']);
  });

  it('colours the map and builds exercise groups from confirmed marks only', () => {
    const stored: StoredMark[] = [
      { muscleId: 'glute_medius', side: 'R', status: 'under', review: 'confirmed', sources: ['ohs.knee_valgus'] },
      { muscleId: 'glute_medius', side: 'L', status: 'under', review: 'confirmed', sources: ['sls.pelvic_drop'] },
      { muscleId: 'adductors', side: 'L', status: 'over', review: 'confirmed', sources: [] },
      { muscleId: 'tfl', side: 'R', status: 'over', review: 'rejected', sources: [] },
      { muscleId: 'abs', side: 'none', status: 'normal', review: 'confirmed', sources: [] },
    ];
    expect(markStates(stored)).toEqual({ 'glute_medius.R': 'under', 'glute_medius.L': 'under', 'adductors.L': 'over', abs: 'normal' });
    expect(confirmedMarks(stored).map((m) => `${m.muscleId}.${m.side}`)).toEqual(['abs.none', 'glute_medius.L', 'glute_medius.R', 'adductors.L']);
    expect(confirmedGroups(stored)).toEqual([
      { muscleId: 'glute_medius', status: 'under', sides: ['L', 'R'], sources: ['ohs.knee_valgus', 'sls.pelvic_drop'] },
      { muscleId: 'adductors', status: 'over', sides: ['L'], sources: [] },
    ]);
  });
});

describe('also check and also consider', () => {
  it('collects checks once with every finding that raised them', () => {
    const f = observedFindings([
      { definition: test('overhead_squat'), status: 'done', results: [r('ohs.knee_valgus', 'L', 'severe'), r('ohs.heel_rise', 'L', 'slight'), r('ohs.arms_fall_forward', 'L', 'slight')] },
    ]);
    expect(alsoChecks(f)).toEqual([
      { id: 'ankle_mobility', label: 'Ankle mobility', from: ['Knees cave in', 'Heels lift'] },
      { id: 'upper_back_mobility', label: 'Upper-back mobility', from: ['Arms fall forward'] },
    ]);
  });

  it('names contributors that have no map region', () => {
    const f = observedFindings([{ definition: test('push_up'), status: 'done', results: [r('pu.scapular_winging', 'L', 'slight')] }]);
    expect(alsoConsider(f)).toEqual([{ label: 'Serratus anterior', from: ['Shoulder blades wing'] }]);
  });
});

describe('checkMarks', () => {
  const ok = { muscleId: 'glute_medius', side: 'L', status: 'under', review: 'confirmed', sources: ['ohs.knee_valgus'] };
  it('accepts good marks', () => expect(checkMarks([ok])).toEqual([ok]));
  it('refuses unknown muscles, sides that do not fit, bad statuses, repeats and bad sources', () => {
    expect(checkMarks([{ ...ok, muscleId: 'knee' }])).toBeNull();
    expect(checkMarks([{ ...ok, muscleId: 'abs', side: 'L' }])).toBeNull();
    expect(checkMarks([{ ...ok, side: 'none' }])).toBeNull();
    expect(checkMarks([{ ...ok, status: 'tight' }])).toBeNull();
    expect(checkMarks([{ ...ok, review: 'pending' }])).toBeNull();
    expect(checkMarks([ok, ok])).toBeNull();
    expect(checkMarks([{ ...ok, sources: ['DROP TABLE'] }])).toBeNull();
    expect(checkMarks('x')).toBeNull();
  });
  it('checks Also check ids', () => {
    expect(checkAlsoCheckIds(['ankle_mobility', 'ankle_mobility'])).toEqual(['ankle_mobility']);
    expect(checkAlsoCheckIds(['nope'])).toBeNull();
  });
});
