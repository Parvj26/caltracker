import { describe, expect, it } from 'vitest';
import { chartModel, parseStrengthCache } from './strength-logic';

const ex = {
  exerciseId: 'sq',
  name: 'Squat',
  points: [
    { date: '2026-10-20', e1rmKg: 93.3, bestSet: { weightKg: 80, reps: 5 } },
    { date: '2026-10-27', e1rmKg: 105, bestSet: { weightKg: 90, reps: 5 } },
  ],
};

describe('chartModel', () => {
  it('turns the series into points a day apart per day, with texts in the chosen unit', () => {
    const m = chartModel(ex, 'kg');
    expect(m.points.map((p) => p.y)).toEqual([93.3, 105]);
    expect(m.points[1].x - m.points[0].x).toBe(7);
    expect(m.points[0].label).toBe('20 Oct: 93.3 kg estimated 1RM, from 80 kg × 5');
    expect(m.xLabel(m.points[0].x)).toBe('20 Oct');
    expect(m.yLabel(105)).toBe('105 kg');
    expect(m.summary).toContain('Squat: 2 workouts');
  });
  it('shows pounds when the client uses them', () => {
    expect(chartModel(ex, 'lb').yLabel(100)).toBe('220 lb');
  });
});

describe('parseStrengthCache', () => {
  it('reads back what was saved and ignores junk', () => {
    expect(parseStrengthCache(JSON.stringify({ exercises: [ex] }))).toEqual({ exercises: [ex] });
    expect(parseStrengthCache(null)).toBeNull();
    expect(parseStrengthCache('nope')).toBeNull();
    expect(parseStrengthCache('{"exercises":[{"name":1}]}')).toBeNull();
  });
});
