import { describe, expect, it } from 'vitest';
import { MAX_LB_DISPLAY_DRIFT_KG, METRICS, formatMetric, fromDisplay, isInRange, toInputValue } from '../../src/body/metrics';
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
    expect(toInputValue('weight_kg', 80, 'lb')).toBe(176.4);
    expect(toInputValue('weight_kg', 80, 'kg')).toBe(80);
    expect(toInputValue('body_fat_pct', 18.2, 'lb')).toBe(18.2);
    expect(fromDisplay('body_fat_pct', 18.2, 'lb')).toBe(18.2);
  });
  it('round trips kg to lb and back within the 1 decimal display step', () => {
    for (const key of ['weight_kg', 'smm_kg', 'lbm_kg'] as const) {
      for (let kg = 5; kg <= 250; kg += 0.37) {
        const back = fromDisplay(key, toInputValue(key, kg, 'lb'), 'lb');
        expect(Math.abs(back - kg)).toBeLessThanOrEqual(MAX_LB_DISPLAY_DRIFT_KG + 0.0005);
      }
    }
  });
  it('is stable once a value is stored: lb typed, stored, shown gives the same lb, and kg is exact', () => {
    for (let lb = 44; lb <= 500; lb += 0.1) {
      const typed = Math.round(lb * 10) / 10;
      const kg = fromDisplay('weight_kg', typed, 'lb');
      expect(toInputValue('weight_kg', kg, 'lb')).toBe(typed);
      expect(fromDisplay('weight_kg', toInputValue('weight_kg', kg, 'kg'), 'kg')).toBe(kg);
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
    expect(changeSince([p('2026-10-06', 19.6), p('2026-11-01', 18.2)], 'body_fat_pct', 'kg', '2026-11-05')).toBe('−1.4 since 6 Oct');
  });
  it('words a rise with a plus', () => {
    expect(changeSince([p('2026-10-06', 18.2), p('2026-11-01', 19.6)], 'body_fat_pct', 'kg', '2026-11-05')).toBe('+1.4 since 6 Oct');
  });
  it('says no change for zero, including float noise', () => {
    expect(changeSince([p('2026-10-06', 0.1 + 0.2), p('2026-11-01', 0.3)], 'body_fat_pct', 'kg', '2026-11-05')).toBe('No change since 6 Oct');
  });
  it('adds the year outside the current year', () => {
    expect(changeSince([p('2025-10-06', 80), p('2026-11-01', 79)], 'body_fat_pct', 'kg', '2026-11-05')).toBe('−1 since 6 Oct 2025');
  });
  it('returns null with fewer than 2 points', () => {
    expect(changeSince([p('2026-10-06', 1)], 'body_fat_pct', 'kg', '2026-11-05')).toBeNull();
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

describe('formatMetric', () => {
  it('formats mass in both units without trailing zeros', () => {
    expect(formatMetric('weight_kg', 72.3, 'kg')).toBe('72.3 kg');
    expect(formatMetric('weight_kg', 72, 'kg')).toBe('72 kg');
    expect(formatMetric('smm_kg', 72.3, 'lb')).toBe('159.4 lb');
  });
  it('formats the others', () => {
    expect(formatMetric('body_fat_pct', 18, 'kg')).toBe('18.0%');
    expect(formatMetric('bmi', 23.456, 'lb')).toBe('23.5');
    expect(formatMetric('visceral_fat', 7.4, 'kg')).toBe('7');
    expect(formatMetric('bmr_kcal', 1650.4, 'kg')).toBe('1650 kcal');
    expect(formatMetric('custom:x', 12.5, 'kg', { unit_label: 'cm', min: 0, max: 99 })).toBe('12.5 cm');
    expect(formatMetric('custom:x', 12.5, 'kg')).toBe('12.5');
  });
  it('changeSince agrees with displayed lb values', () => {
    const s = [{ date: '2026-10-06', value: 80 }, { date: '2026-11-01', value: 78.6 }];
    expect(changeSince(s, 'weight_kg', 'lb', '2026-11-05')).toBe('\u22123.1 since 6 Oct');
    expect(changeSince(s, 'weight_kg', 'kg', '2026-11-05')).toBe('\u22121.4 since 6 Oct');
  });
});

describe('isInRange', () => {
  it('is inclusive for built-in and custom', () => {
    expect(isInRange('body_fat_pct', 2)).toBe(true);
    expect(isInRange('body_fat_pct', 75)).toBe(true);
    expect(isInRange('body_fat_pct', 1.99)).toBe(false);
    expect(isInRange('body_fat_pct', 75.01)).toBe(false);
    expect(isInRange('custom:x', 5, { min: 5, max: 9 })).toBe(true);
    expect(isInRange('custom:x', 9.1, { min: 5, max: 9 })).toBe(false);
    expect(isInRange('custom:x', 5)).toBe(false);
    expect(isInRange('toString', 5)).toBe(false);
    expect(isInRange('weight_kg', NaN)).toBe(false);
  });
});

describe('measurementSeries extras', () => {
  it('keeps the latest value per date', () => {
    const out = measurementSeries(
      [
        { measured_on: '2026-11-01', value: 1, createdAt: '2026-11-01T09:00:00Z' },
        { measured_on: '2026-11-01', value: 2, createdAt: '2026-11-01T08:00:00Z' },
        { measured_on: '2026-11-02', value: 3 },
        { measured_on: '2026-11-02', value: 4 },
      ],
      'all',
      '2026-11-05',
    );
    expect(out).toEqual([{ date: '2026-11-01', value: 1 }, { date: '2026-11-02', value: 4 }]);
  });
  it('includes exactly 365 days back for 1y', () => {
    expect(measurementSeries([{ measured_on: '2025-11-05', value: 1 }, { measured_on: '2026-11-05', value: 2 }], '1y', '2026-11-05')).toHaveLength(2);
    expect(measurementSeries([{ measured_on: '2025-11-04', value: 1 }, { measured_on: '2026-11-05', value: 2 }], '1y', '2026-11-05')).toEqual([]);
  });
});
