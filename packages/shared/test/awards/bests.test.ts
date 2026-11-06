import { describe, expect, it } from 'vitest';
import { awardHasPrs, personalBestRows, streakLabel } from '../../src/awards/bests';

const rec = (exerciseId: string, name: string, kind: 'heaviest' | 'reps_at_weight' | 'e1rm', valueKg: number, reps: number | null, achievedAt: string) => ({
  exerciseId,
  name,
  kind,
  valueKg,
  reps,
  achievedAt,
});

describe('personalBestRows', () => {
  it('gives one row per exercise with the heaviest set, the e1RM and its date, sorted by name', () => {
    const rows = personalBestRows([
      rec('sq', 'Squat', 'heaviest', 100, 5, '2026-11-01T10:00:00Z'),
      rec('sq', 'Squat', 'e1rm', 116.7, 5, '2026-11-01T10:00:00Z'),
      rec('sq', 'Squat', 'reps_at_weight', 100, 5, '2026-11-01T10:00:00Z'),
      rec('sq', 'Squat', 'reps_at_weight', 80, 12, '2026-10-20T10:00:00Z'),
      rec('bp', 'Bench Press', 'heaviest', 70, 8, '2026-10-30T10:00:00Z'),
      rec('bp', 'Bench Press', 'e1rm', 88.7, 8, '2026-10-30T10:00:00Z'),
    ]);
    expect(rows).toEqual([
      { exerciseId: 'bp', name: 'Bench Press', weightKg: 70, reps: 8, e1rmKg: 88.7, achievedAt: '2026-10-30T10:00:00Z' },
      { exerciseId: 'sq', name: 'Squat', weightKg: 100, reps: 5, e1rmKg: 116.7, achievedAt: '2026-11-01T10:00:00Z' },
    ]);
  });

  it('copes with an exercise that has only one of the two kinds', () => {
    expect(personalBestRows([rec('x', 'Curl', 'e1rm', 30, 10, '2026-11-01T00:00:00Z')])).toEqual([
      { exerciseId: 'x', name: 'Curl', weightKg: null, reps: null, e1rmKg: 30, achievedAt: '2026-11-01T00:00:00Z' },
    ]);
    expect(personalBestRows([rec('x', 'Curl', 'reps_at_weight', 20, 12, '2026-11-01T00:00:00Z')])).toEqual([]);
    expect(personalBestRows([])).toEqual([]);
  });
});

describe('awardHasPrs', () => {
  it('is true only when the stored result lists at least one PR', () => {
    expect(awardHasPrs({ prs: [{ kind: 'heaviest' }] })).toBe(true);
    expect(awardHasPrs({ prs: [] })).toBe(false);
    expect(awardHasPrs({})).toBe(false);
    expect(awardHasPrs(null)).toBe(false);
    expect(awardHasPrs('nope')).toBe(false);
  });
});

describe('streakLabel', () => {
  it('words the streak in weeks', () => {
    expect(streakLabel(3)).toBe('3-week streak');
    expect(streakLabel(1)).toBe('1-week streak');
    expect(streakLabel(0)).toBe('No streak yet');
  });
});
