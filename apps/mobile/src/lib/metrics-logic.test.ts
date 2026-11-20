import { describe, expect, it } from 'vitest';
import type { MetricEntry } from '@caltracker/shared';
import { appleHealthBatches, parseCachedMetrics, serializeMetrics } from './metrics-logic';

const entry: MetricEntry = {
  origin: 'body_metrics', id: 'a', metricKey: 'waist_cm', value: 82, measuredOn: '2026-11-01', measuredAt: null,
  createdAt: '2026-11-01T09:00:00Z', source: 'manual', enteredBy: 'client', externalId: null,
};

describe('saved Metrics copy', () => {
  it('reads back what it saved', () => {
    expect(parseCachedMetrics(serializeMetrics([entry]))).toEqual([entry]);
  });
  it('ignores missing, broken or older copies, and entries it cannot read', () => {
    expect(parseCachedMetrics(null)).toBe(null);
    expect(parseCachedMetrics('{')).toBe(null);
    expect(parseCachedMetrics(JSON.stringify({ entries: [entry] }))).toBe(null);
    expect(parseCachedMetrics(JSON.stringify({ v: 1, entries: [entry, { ...entry, metricKey: 'steps' }, 5] }))).toEqual([entry]);
  });
});

describe('appleHealthBatches', () => {
  const sample = (i: number, over = {}) => ({
    externalId: `hk-${i}`, metricKey: 'weight_kg' as const, value: 80, measuredOn: '2026-11-01', measuredAt: null, ...over,
  });
  it('sends what the database takes, in batches of 500', () => {
    const batches = appleHealthBatches(Array.from({ length: 1001 }, (_, i) => sample(i)));
    expect(batches.map((b) => b.length)).toEqual([500, 500, 1]);
    expect(batches[0][0]).toEqual({ external_id: 'hk-0', metric_key: 'weight_kg', value: 80, measured_on: '2026-11-01', measured_at: null });
  });
  it('skips samples it would refuse', () => {
    const batches = appleHealthBatches([
      sample(1, { metricKey: 'smm_kg', value: 30 }),
      sample(2, { value: 500 }),
      sample(3, { externalId: '' }),
      sample(4, { measuredOn: 'yesterday' }),
      sample(5),
    ]);
    expect(batches).toEqual([[expect.objectContaining({ external_id: 'hk-5' })]]);
  });
  it('sends nothing for no samples', () => {
    expect(appleHealthBatches([])).toEqual([]);
  });
});
