import { describe, expect, it } from 'vitest';
import {
  METRIC_RANGES,
  canEditMetricEntry,
  metricDailyEntries,
  metricSummary,
  metricsSummary,
  toMetricEntries,
  toMetricEntry,
} from '../../src/metrics/summary';
import type { MetricEntry, MetricEntryRow } from '../../src/metrics/summary';
import { METRIC_KEYS } from '../../src/metrics/catalogue';

const today = '2026-11-19';
let n = 0;
const entry = (over: Partial<MetricEntry>): MetricEntry => ({
  origin: 'body_metrics',
  id: `id-${++n}`,
  metricKey: 'weight_kg',
  value: 80,
  measuredOn: '2026-11-01',
  measuredAt: null,
  createdAt: '2026-11-01T09:00:00Z',
  source: 'manual',
  enteredBy: 'client',
  externalId: null,
  ...over,
});
const row = (over: Partial<MetricEntryRow>): MetricEntryRow => ({
  origin: 'body_measurements',
  id: 'm1',
  metric_key: 'weight_kg',
  value: '80.500',
  measured_on: '2026-10-01',
  measured_at: null,
  created_at: '2026-10-01T09:00:00Z',
  source: 'inbody_scan',
  entered_by_role: 'coach',
  external_id: null,
  ...over,
});

describe('toMetricEntry', () => {
  it('reads a view row (numeric comes back as text)', () => {
    expect(toMetricEntry(row({}))).toEqual({
      origin: 'body_measurements', id: 'm1', metricKey: 'weight_kg', value: 80.5, measuredOn: '2026-10-01',
      measuredAt: null, createdAt: '2026-10-01T09:00:00Z', source: 'inbody_scan', enteredBy: 'coach', externalId: null,
    });
  });

  it('leaves out rows this version does not know, instead of failing', () => {
    expect(toMetricEntry(row({ metric_key: 'steps' }))).toBe(null);
    expect(toMetricEntry(row({ source: 'garmin' }))).toBe(null);
    expect(toMetricEntry(row({ origin: 'other' }))).toBe(null);
    expect(toMetricEntry(row({ value: null }))).toBe(null);
    expect(toMetricEntry(row({ value: 'abc' }))).toBe(null);
    expect(toMetricEntry(row({ entered_by_role: null }))).toBe(null);
    expect(toMetricEntries([row({}), row({ metric_key: 'bmi' })])).toHaveLength(1);
  });
});

describe('metricDailyEntries', () => {
  it('keeps one value per day, oldest first', () => {
    const daily = metricDailyEntries(
      [
        entry({ measuredOn: '2026-11-02', value: 79, createdAt: '2026-11-02T08:00:00Z' }),
        entry({ measuredOn: '2026-11-01', value: 81 }),
        entry({ measuredOn: '2026-11-02', value: 78.5, createdAt: '2026-11-02T20:00:00Z' }),
        entry({ metricKey: 'waist_cm', value: 80 }),
      ],
      'weight_kg',
    );
    expect(daily.map((e) => [e.measuredOn, e.value])).toEqual([['2026-11-01', 81], ['2026-11-02', 78.5]]);
  });

  it('prefers a value someone entered over an Apple Health import of the same day', () => {
    const daily = metricDailyEntries(
      [
        entry({ source: 'inbody_scan', enteredBy: 'coach', value: 80, createdAt: '2026-11-01T09:00:00Z' }),
        entry({ source: 'apple_health', value: 79, measuredAt: '2026-11-01T22:00:00Z', createdAt: '2026-11-02T01:00:00Z' }),
      ],
      'weight_kg',
    );
    expect(daily.map((e) => e.value)).toEqual([80]);
  });

  it('orders Apple Health samples of one day by their measured time', () => {
    const daily = metricDailyEntries(
      [
        entry({ source: 'apple_health', value: 79, measuredAt: '2026-11-01T22:00:00Z', createdAt: '2026-11-02T01:00:00Z' }),
        entry({ source: 'apple_health', value: 80, measuredAt: '2026-11-01T07:00:00Z', createdAt: '2026-11-02T01:00:00Z' }),
      ],
      'weight_kg',
    );
    expect(daily.map((e) => e.value)).toEqual([79]);
  });
});

describe('metricSummary', () => {
  const entries = [
    entry({ measuredOn: '2026-11-15', value: 78 }),
    entry({ measuredOn: '2026-10-01', value: 80 }),
    entry({ measuredOn: '2026-06-01', value: 84 }),
    entry({ measuredOn: '2025-06-01', value: 90 }),
  ];

  it('uses the 3 month, 1 year and all ranges', () => {
    expect(METRIC_RANGES).toEqual(['3m', '1y', 'all']);
  });

  it('gives the latest value, the change over the range and the points', () => {
    const s3 = metricSummary(entries, 'weight_kg', '3m', today);
    expect(s3.latest?.value).toBe(78);
    expect(s3.change).toBe(-2);
    expect(s3.changeFrom).toBe('2026-10-01');
    expect(s3.points).toEqual([{ date: '2026-10-01', value: 80 }, { date: '2026-11-15', value: 78 }]);
    expect(metricSummary(entries, 'weight_kg', '1y', today).change).toBe(-6);
    expect(metricSummary(entries, 'weight_kg', 'all', today).change).toBe(-12);
  });

  it('keeps the latest value when the range has none, with no change', () => {
    const old = [entry({ measuredOn: '2025-01-01', value: 70 })];
    const s = metricSummary(old, 'weight_kg', '3m', today);
    expect(s.latest?.value).toBe(70);
    expect(s.change).toBe(null);
    expect(s.changeFrom).toBe(null);
    expect(s.points).toEqual([]);
  });

  it('avoids floating point noise in the change', () => {
    const s = metricSummary([entry({ measuredOn: '2026-11-01', value: 80.1 }), entry({ measuredOn: '2026-11-02', value: 80.3 })],
      'weight_kg', 'all', today);
    expect(s.change).toBe(0.2);
  });

  it('gives every card in catalogue order, empty ones included', () => {
    const all = metricsSummary(entries, '3m', today);
    expect(all.map((s) => s.key)).toEqual([...METRIC_KEYS]);
    expect(all[3]).toEqual({ key: 'vo2_max', latest: null, change: null, changeFrom: null, points: [] });
  });
});

describe('canEditMetricEntry', () => {
  it('lets each side edit only its own manual Metrics entries', () => {
    expect(canEditMetricEntry(entry({ enteredBy: 'client' }), 'client')).toBe(true);
    expect(canEditMetricEntry(entry({ enteredBy: 'client' }), 'coach')).toBe(false);
    expect(canEditMetricEntry(entry({ enteredBy: 'coach' }), 'coach')).toBe(true);
    expect(canEditMetricEntry(entry({ source: 'apple_health' }), 'client')).toBe(false);
    expect(canEditMetricEntry(entry({ origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' }), 'coach')).toBe(false);
  });
});
