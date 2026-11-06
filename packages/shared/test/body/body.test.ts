import { describe, expect, it } from 'vitest';
import { MAX_LB_DISPLAY_DRIFT_KG, METRICS, fromDisplay, toDisplay } from '../../src/body/metrics';
import { changeSince, measurementSeries } from '../../src/body/series';
import { isScanDue } from '../../src/body/due';

describe('metrics', () => {
  it('has the agreed ranges', () => {
    expect(METRICS.weight_kg).toMatchObject({ min: 20, max: 400, mass: true });
    expect(METRICS.body_fat_pct).toMatchObject({ min: 2, max: 75, mass: false });
    expect(METRICS.bmr_kcal).toMatchObject({ min: 500, max: 5000 });
    expect(Object.keys(METRICS)).toHaveLength(7);
  });
  it('converts mass to lb with 1 decimal and leaves others alone', () => {
    expect(toDisplay('weight_kg', 80, 'lb')).toBe(176.4);
    expect(toDisplay('weight_kg', 80, 'kg')).toBe(80);
    expect(toDisplay('body_fat_pct', 18.2, 'lb')).toBe(18.2);
    expect(fromDisplay('body_fat_pct', 18.2, 'lb')).toBe(18.2);
  });
  it('round trips kg to lb and back within the 1 decimal display step', () => {
    for (const key of ['weight_kg', 'smm_kg', 'lbm_kg'] as const) {
      for (let kg = 5; kg <= 250; kg += 0.37) {
        const back = fromDisplay(key, toDisplay(key, kg, 'lb'), 'lb');
        expect(Math.abs(back - kg)).toBeLessThanOrEqual(MAX_LB_DISPLAY_DRIFT_KG + 0.0005);
      }
    }
  });
  it('is stable once a value is stored: lb typed, stored, shown gives the same lb, and kg is exact', () => {
    for (let lb = 44; lb <= 500; lb += 0.1) {
      const typed = Math.round(lb * 10) / 10;
      const kg = fromDisplay('weight_kg', typed, 'lb');
      expect(toDisplay('weight_kg', kg, 'lb')).toBe(typed);
      expect(fromDisplay('weight_kg', toDisplay('weight_kg', kg, 'kg'), 'kg')).toBe(kg);
    }
  });
});

describe('measurementSeries', () => {
  const rows = [
    { measured_on: '2026-10-06', value: 80 },
    { measured_on: '2026-01-01', value: 85 },
    { measured_on: '2026-11-01', value: 78.6 },
    { measured_on: '2025-01-01', value: 90 },
  ];
  it('sorts by date and filters by range', () => {
    expect(measurementSeries(rows, '3m', '2026-11-05').map((p) => p.date)).toEqual(['2026-10-06', '2026-11-01']);
    expect(measurementSeries(rows, '1y', '2026-11-05').map((p) => p.date)).toEqual(['2026-01-01', '2026-10-06', '2026-11-01']);
    expect(measurementSeries(rows, 'all', '2026-11-05')).toHaveLength(4);
  });
  it('includes the boundary day', () => {
    expect(measurementSeries([{ measured_on: '2026-08-06', value: 1 }, { measured_on: '2026-11-05', value: 2 }], '3m', '2026-11-05')).toHaveLength(2);
    expect(measurementSeries([{ measured_on: '2026-08-05', value: 1 }, { measured_on: '2026-11-05', value: 2 }], '3m', '2026-11-05')).toEqual([]);
  });
  it('gives no series for a single point', () => {
    expect(measurementSeries([rows[0]!], 'all', '2026-11-05')).toEqual([]);
    expect(measurementSeries([], 'all', '2026-11-05')).toEqual([]);
  });
});

describe('changeSince', () => {
  const p = (date: string, value: number) => ({ date, value });
  it('words a drop with a minus sign', () => {
    expect(changeSince([p('2026-10-06', 19.6), p('2026-11-01', 18.2)], '2026-11-05')).toBe('−1.4 since 6 Oct');
  });
  it('words a rise with a plus', () => {
    expect(changeSince([p('2026-10-06', 18.2), p('2026-11-01', 19.6)], '2026-11-05')).toBe('+1.4 since 6 Oct');
  });
  it('says no change for zero, including float noise', () => {
    expect(changeSince([p('2026-10-06', 0.1 + 0.2), p('2026-11-01', 0.3)], '2026-11-05')).toBe('No change since 6 Oct');
  });
  it('adds the year outside the current year', () => {
    expect(changeSince([p('2025-10-06', 80), p('2026-11-01', 79)], '2026-11-05')).toBe('−1 since 6 Oct 2025');
  });
  it('returns null with fewer than 2 points', () => {
    expect(changeSince([p('2026-10-06', 1)], '2026-11-05')).toBeNull();
  });
});

describe('isScanDue', () => {
  const today = '2026-11-05';
  it('is due at exactly 30 days, not at 29', () => {
    expect(isScanDue({ joinedOn: '2026-01-01' }, '2026-10-06', today)).toBe(true);
    expect(isScanDue({ joinedOn: '2026-01-01' }, '2026-10-07', today)).toBe(false);
  });
  it('never scanned: due only if joined 30+ days ago', () => {
    expect(isScanDue({ joinedOn: '2026-10-06' }, null, today)).toBe(true);
    expect(isScanDue({ joinedOn: '2026-10-07' }, null, today)).toBe(false);
  });
});
