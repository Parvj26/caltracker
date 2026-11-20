import { describe, expect, it } from 'vitest';
import {
  METRIC_CATALOGUE,
  METRIC_KEYS,
  formatMetricDelta,
  formatMetricValue,
  isMetricInRange,
  isMetricKey,
  lengthUnitFor,
  metricAllowsSource,
  metricFromDisplay,
  metricToDisplay,
  metricUnit,
  parseMetricInput,
} from '../../src/metrics/catalogue';

describe('metric catalogue', () => {
  it('has the six approved metrics in card order, and no steps', () => {
    expect(METRIC_KEYS).toEqual(['weight_kg', 'body_fat_pct', 'smm_kg', 'vo2_max', 'waist_cm', 'resting_hr_bpm']);
    expect(METRIC_KEYS.map((k) => METRIC_CATALOGUE[k].label)).toEqual([
      'Weight', 'Body fat', 'Muscle mass', 'VO2 max', 'Waist', 'Resting heart rate',
    ]);
    expect(isMetricKey('steps')).toBe(false);
    expect(isMetricKey('bmi')).toBe(false);
    for (const k of METRIC_KEYS) expect(METRIC_CATALOGUE[k].key).toBe(k);
  });

  it('matches the database ranges (inclusive)', () => {
    const ranges = Object.fromEntries(METRIC_KEYS.map((k) => [k, [METRIC_CATALOGUE[k].min, METRIC_CATALOGUE[k].max]]));
    expect(ranges).toEqual({
      weight_kg: [20, 400], body_fat_pct: [2, 75], smm_kg: [5, 120], vo2_max: [10, 100], waist_cm: [40, 250],
      resting_hr_bpm: [25, 220],
    });
    expect(isMetricInRange('resting_hr_bpm', 220)).toBe(true);
    expect(isMetricInRange('resting_hr_bpm', 221)).toBe(false);
    expect(isMetricInRange('weight_kg', NaN)).toBe(false);
  });

  it('knows which sources each metric can have', () => {
    expect(metricAllowsSource('weight_kg', 'apple_health')).toBe(true);
    expect(metricAllowsSource('smm_kg', 'apple_health')).toBe(false);
    expect(metricAllowsSource('smm_kg', 'inbody_scan')).toBe(true);
    expect(metricAllowsSource('vo2_max', 'inbody_scan')).toBe(false);
    for (const k of METRIC_KEYS) expect(metricAllowsSource(k, 'manual')).toBe(true);
  });
});

describe('units', () => {
  it('follows the viewer: kg → cm, lb → in; others fixed', () => {
    expect(lengthUnitFor('kg')).toBe('cm');
    expect(lengthUnitFor('lb')).toBe('in');
    expect(metricUnit('weight_kg', 'lb')).toBe('lb');
    expect(metricUnit('smm_kg', 'kg')).toBe('kg');
    expect(metricUnit('waist_cm', 'lb')).toBe('in');
    expect(metricUnit('vo2_max', 'lb')).toBe('mL/kg/min');
    expect(metricUnit('resting_hr_bpm', 'kg')).toBe('bpm');
  });

  it('converts stored values for display and back', () => {
    expect(metricToDisplay('weight_kg', 80, 'lb')).toBe(176.4);
    expect(metricToDisplay('waist_cm', 82, 'lb')).toBe(32.3);
    expect(metricToDisplay('waist_cm', 82, 'kg')).toBe(82);
    expect(metricToDisplay('resting_hr_bpm', 57.6, 'lb')).toBe(58);
    expect(metricFromDisplay('weight_kg', 176.4, 'lb')).toBe(80.014);
    expect(metricFromDisplay('waist_cm', 32, 'lb')).toBe(81.28);
    expect(metricFromDisplay('body_fat_pct', 18.25, 'lb')).toBe(18.25);
  });

  it('formats values', () => {
    expect(formatMetricValue('weight_kg', 72.3, 'kg')).toBe('72.3 kg');
    expect(formatMetricValue('weight_kg', 72.3, 'lb')).toBe('159.4 lb');
    expect(formatMetricValue('body_fat_pct', 18.2, 'lb')).toBe('18.2%');
    expect(formatMetricValue('vo2_max', 42.5, 'kg')).toBe('42.5 mL/kg/min');
    expect(formatMetricValue('waist_cm', 82, 'lb')).toBe('32.3 in');
    expect(formatMetricValue('waist_cm', 82, 'kg')).toBe('82.0 cm');
    expect(formatMetricValue('resting_hr_bpm', 58, 'kg')).toBe('58 bpm');
  });

  it('formats changes with a real minus sign, in the viewer units', () => {
    expect(formatMetricDelta('weight_kg', -1.5, 'kg')).toBe('−1.5 kg');
    expect(formatMetricDelta('weight_kg', -1.5, 'lb')).toBe('−3.3 lb');
    expect(formatMetricDelta('body_fat_pct', 0.4, 'kg')).toBe('+0.4%');
    expect(formatMetricDelta('resting_hr_bpm', -3, 'kg')).toBe('−3 bpm');
    expect(formatMetricDelta('waist_cm', 2.54, 'lb')).toBe('+1.0 in');
    expect(formatMetricDelta('weight_kg', 0.02, 'kg')).toBe('No change');
  });
});

describe('parseMetricInput', () => {
  it('reads a typed value in the viewer units', () => {
    expect(parseMetricInput('weight_kg', ' 80,5 ', 'kg')).toEqual({ ok: true, value: 80.5 });
    expect(parseMetricInput('waist_cm', '32', 'lb')).toEqual({ ok: true, value: 81.28 });
    expect(parseMetricInput('resting_hr_bpm', '58', 'lb')).toEqual({ ok: true, value: 58 });
  });

  it('explains what is wrong', () => {
    expect(parseMetricInput('vo2_max', '', 'kg')).toEqual({ ok: false, error: 'Enter the VO2 max.' });
    expect(parseMetricInput('waist_cm', 'abc', 'kg')).toEqual({ ok: false, error: 'Enter the waist as a number.' });
    expect(parseMetricInput('resting_hr_bpm', '300', 'kg')).toEqual({
      ok: false, error: 'Enter a resting heart rate between 25 and 220 bpm.',
    });
    expect(parseMetricInput('waist_cm', '10', 'lb')).toEqual({ ok: false, error: 'Enter a waist between 15.8 and 98.4 in.' });
    expect(parseMetricInput('body_fat_pct', '90', 'kg')).toEqual({ ok: false, error: 'Enter a body fat between 2.0 and 75.0%.' });
  });

  it('always accepts the limits the message names', () => {
    for (const key of METRIC_KEYS) {
      for (const units of ['kg', 'lb'] as const) {
        const r = parseMetricInput(key, '0', units);
        if (r.ok) continue;
        const [lo, hi] = r.error.match(/between ([\d.]+) and ([\d.]+)/)!.slice(1);
        expect(parseMetricInput(key, lo!, units).ok, `${key} ${units} ${lo}`).toBe(true);
        expect(parseMetricInput(key, hi!, units).ok, `${key} ${units} ${hi}`).toBe(true);
      }
    }
  });
});
