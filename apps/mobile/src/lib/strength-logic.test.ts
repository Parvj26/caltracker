import { describe, expect, it } from 'vitest';
import { heaviestSessions, type StrengthPoint } from '@caltracker/shared';
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
  const sessions = heaviestSessions(ex.points, 'weight');
  it('charts the heaviest weight per session a day apart per day, with texts in the chosen unit', () => {
    const m = chartModel('Squat', sessions, 'weight', 'kg', '2026-11-19');
    expect(m.points.map((p) => p.y)).toEqual([80, 90]);
    expect(m.points[1].x - m.points[0].x).toBe(7);
    expect(m.points[0].label).toBe('20 Oct: heaviest 80 kg × 5, estimated 1-rep max 93.3 kg');
    expect(m.xLabel(m.points[0].x)).toBe('20 Oct');
    expect(m.yLabel(105)).toBe('105 kg');
    expect(m.summary).toContain('Squat, heaviest weight per session: 2 sessions');
  });
  it('shows pounds when the client uses them', () => {
    expect(chartModel('Squat', sessions, 'weight', 'lb', '2026-11-19').yLabel(100)).toBe('220 lb');
  });
  it('reads a series saved before heaviest sets were kept (older phone cache)', () => {
    const old = parseHubLikePoints([{ date: '2026-10-20', e1rmKg: 93.3, bestSet: { weightKg: 80, reps: 5 } }]);
    expect(chartModel('Squat', heaviestSessions(old, 'weight'), 'weight', 'kg', '2026-11-19').points[0]?.y).toBe(80);
  });
});

const parseHubLikePoints = (p: StrengthPoint[]) => JSON.parse(JSON.stringify(p)) as StrengthPoint[];

describe('parseStrengthCache', () => {
  it('reads back what was saved and ignores junk', () => {
    expect(parseStrengthCache(JSON.stringify({ exercises: [ex] }))).toEqual({ exercises: [ex] });
    expect(parseStrengthCache(null)).toBeNull();
    expect(parseStrengthCache('nope')).toBeNull();
    expect(parseStrengthCache('{"exercises":[{"name":1}]}')).toBeNull();
  });
});
