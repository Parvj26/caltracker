import { describe, expect, it } from 'vitest';
import { OVERVIEW_METRICS, OVERVIEW_PERIODS, bodyOverview, formatMetricChange } from '../../src/body/overview';

const scan = (measuredOn: string, values: Record<string, number>, createdAt = `${measuredOn}T09:00:00Z`) => ({ measuredOn, createdAt, values });
const today = '2026-11-06';

describe('bodyOverview', () => {
  const scans = [
    scan('2026-11-05', { weight_kg: 80, body_fat_pct: 19 }),
    scan('2026-10-20', { weight_kg: 81.5, smm_kg: 35 }),
    scan('2026-10-01', { weight_kg: 83, body_fat_pct: 21, smm_kg: 34 }),
    scan('2026-06-01', { weight_kg: 86 }),
  ];

  it('covers weight, body fat and skeletal muscle mass in that order', () => {
    expect(OVERVIEW_METRICS).toEqual(['weight_kg', 'body_fat_pct', 'smm_kg']);
    expect(OVERVIEW_PERIODS).toEqual(['4w', '3m', '1y', 'all']);
    expect(bodyOverview(scans, '4w', today).map((m) => m.key)).toEqual(OVERVIEW_METRICS);
  });

  it('shows the latest value whatever the period', () => {
    const [weight, fat, smm] = bodyOverview(scans, '4w', today);
    expect(weight!.latest).toEqual({ date: '2026-11-05', value: 80 });
    expect(fat!.latest).toEqual({ date: '2026-11-05', value: 19 });
    expect(smm!.latest).toEqual({ date: '2026-10-20', value: 35 });
  });

  it('measures the change from the first value in the period to the latest', () => {
    const [weight, fat, smm] = bodyOverview(scans, '4w', today);
    // 4 weeks back is 9 October: only 20 Oct and 5 Nov are inside.
    expect(weight!.points.map((p) => p.date)).toEqual(['2026-10-20', '2026-11-05']);
    expect(weight!.change).toBeCloseTo(-1.5);
    expect(fat!.change).toBe(null); // one value in the period
    expect(smm!.change).toBe(null);
    const [w3m] = bodyOverview(scans, '3m', today);
    expect(w3m!.change).toBeCloseTo(-3);
    const [wAll] = bodyOverview(scans, 'all', today);
    expect(wAll!.change).toBeCloseTo(-6);
  });

  it('keeps one value per day, the one entered last', () => {
    const [weight] = bodyOverview([scan('2026-11-05', { weight_kg: 80 }, '2026-11-05T09:00:00Z'), scan('2026-11-05', { weight_kg: 79 }, '2026-11-05T18:00:00Z')], 'all', today);
    expect(weight!.latest).toEqual({ date: '2026-11-05', value: 79 });
    expect(weight!.points).toHaveLength(1);
  });

  it('is empty without scans', () => {
    expect(bodyOverview([], '4w', today).every((m) => m.latest === null && m.change === null && m.points.length === 0)).toBe(true);
  });
});

describe('formatMetricChange', () => {
  it('shows the change in the viewer units with a real minus sign', () => {
    expect(formatMetricChange('weight_kg', -1.5, 'kg')).toBe('−1.5 kg');
    expect(formatMetricChange('weight_kg', -1.5, 'lb')).toBe('−3.3 lb');
    expect(formatMetricChange('body_fat_pct', 0.4, 'kg')).toBe('+0.4%');
    expect(formatMetricChange('smm_kg', 0, 'kg')).toBe('No change');
  });
});
