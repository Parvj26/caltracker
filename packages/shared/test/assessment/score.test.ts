import { describe, expect, it } from 'vitest';
import { movementScore, scoreBand, testScore, type ScoreInput } from '../../src/assessment/score';
import type { CheckpointResult, TestDefinition } from '../../src/assessment/types';

/** A small test: one sided checkpoint (2 sides) and one unsided checkpoint, so max = 3 × 2 = 6 points. */
function def(key: string, kind: TestDefinition['kind'] = 'scored', checkpoints = true): TestDefinition {
  return {
    key,
    version: 1,
    name: key,
    summary: '',
    kind,
    steps: [],
    views: checkpoints
      ? [
          {
            id: 'front',
            label: 'Front',
            watch: '',
            groups: [
              {
                label: 'Knees',
                checkpoints: [
                  { id: `${key}.sided`, label: 'Sided', sided: true },
                  { id: `${key}.unsided`, label: 'Unsided', sided: false },
                ],
              },
            ],
          },
        ]
      : [],
    measures: [{ id: `${key}.m`, label: 'M', unit: 'cm', sided: true, higherIsBetter: false, min: 0, max: 50 }],
    followUps: [],
    sources: [],
  };
}

const r = (checkpointId: string, side: CheckpointResult['side'], severity: CheckpointResult['severity']): CheckpointResult => ({
  checkpointId,
  side,
  severity,
});

describe('testScore', () => {
  it('is 100 when every checkpoint is Normal, also when nothing was tapped (untouched = Normal)', () => {
    expect(testScore({ definition: def('a'), status: 'done', results: [] })).toBe(100);
    expect(testScore({ definition: def('a'), status: 'done', results: [r('a.sided', 'L', 'normal'), r('a.unsided', 'none', 'normal')] })).toBe(100);
  });

  it('gives Normal 2, Slight 1 and Severe 0 per checkpoint per side', () => {
    // L severe (0) + R slight (1) + unsided normal (2) = 3 of 6.
    expect(testScore({ definition: def('a'), status: 'done', results: [r('a.sided', 'L', 'severe'), r('a.sided', 'R', 'slight')] })).toBe(50);
    // Everything severe.
    expect(
      testScore({
        definition: def('a'),
        status: 'done',
        results: [r('a.sided', 'L', 'severe'), r('a.sided', 'R', 'severe'), r('a.unsided', 'none', 'severe')],
      }),
    ).toBe(0);
  });

  it('counts an unsided checkpoint once and a sided one twice', () => {
    // Unsided slight: 5 of 6.
    expect(testScore({ definition: def('a'), status: 'done', results: [r('a.unsided', 'none', 'slight')] })).toBe(83);
    // One side of the sided checkpoint slight: also 5 of 6.
    expect(testScore({ definition: def('a'), status: 'done', results: [r('a.sided', 'R', 'slight')] })).toBe(83);
  });

  it('ignores results for checkpoints or sides the definition does not have', () => {
    expect(
      testScore({
        definition: def('a'),
        status: 'done',
        results: [r('a.gone', 'L', 'severe'), r('a.unsided', 'L', 'severe'), r('a.sided', 'none', 'severe')],
      }),
    ).toBe(100);
  });

  it('is null for skipped, stopped and not-yet-done tests, record-only tests and tests with only measures', () => {
    expect(testScore({ definition: def('a'), status: 'skipped', results: [] })).toBeNull();
    expect(testScore({ definition: def('a'), status: 'stopped', results: [r('a.sided', 'L', 'severe')] })).toBeNull();
    expect(testScore({ definition: def('a'), status: 'pending', results: [] })).toBeNull();
    expect(testScore({ definition: def('p', 'record_only'), status: 'done', results: [r('p.sided', 'L', 'severe')] })).toBeNull();
    expect(testScore({ definition: def('m', 'scored', false), status: 'done', results: [] })).toBeNull();
  });
});

describe('movementScore', () => {
  it('pools points over every scored test (points ÷ max × 100), not an average of test scores', () => {
    const tests: ScoreInput[] = [
      // 3 of 6
      { definition: def('a'), status: 'done', results: [r('a.sided', 'L', 'severe'), r('a.sided', 'R', 'slight')] },
      // 6 of 6
      { definition: def('b'), status: 'done', results: [] },
    ];
    const s = movementScore(tests);
    expect(s.overall).toBe(75);
    expect(s.tests.map((t) => t.score)).toEqual([50, 100]);
  });

  it('is 100 when all observed checkpoints are Normal', () => {
    expect(movementScore([{ definition: def('a'), status: 'done', results: [] }, { definition: def('b'), status: 'done', results: [] }]).overall).toBe(100);
  });

  it('leaves out skipped tests, record-only posture and measure-only tests, and says why', () => {
    const s = movementScore([
      { definition: def('a'), status: 'done', results: [r('a.unsided', 'none', 'severe')] },
      { definition: def('b'), status: 'skipped', results: [] },
      { definition: def('p', 'record_only'), status: 'done', results: [r('p.sided', 'L', 'severe')] },
      { definition: def('m', 'scored', false), status: 'done', results: [] },
      { definition: def('s'), status: 'stopped', results: [] },
    ]);
    expect(s.overall).toBe(67);
    expect(s.tests.map((t) => [t.key, t.score, t.notScored])).toEqual([
      ['a', 67, null],
      ['b', null, 'skipped'],
      ['p', null, 'record_only'],
      ['m', null, 'measured'],
      ['s', null, 'stopped'],
    ]);
  });

  it('has no overall score when nothing was scored', () => {
    expect(movementScore([]).overall).toBeNull();
    expect(movementScore([{ definition: def('b'), status: 'skipped', results: [] }]).overall).toBeNull();
  });

  it('rounds to a whole number', () => {
    // 5 of 6 = 83.33 → 83.
    expect(movementScore([{ definition: def('a'), status: 'done', results: [r('a.unsided', 'none', 'slight')] }]).overall).toBe(83);
  });
});

describe('scoreBand', () => {
  it('maps 0–49 Needs work, 50–69 Fair, 70–84 Good, 85–100 Great', () => {
    expect([0, 49, 50, 69, 70, 84, 85, 100].map((n) => scoreBand(n).label)).toEqual([
      'Needs work',
      'Needs work',
      'Fair',
      'Fair',
      'Good',
      'Good',
      'Great',
      'Great',
    ]);
    expect(scoreBand(68).id).toBe('fair');
  });
});
