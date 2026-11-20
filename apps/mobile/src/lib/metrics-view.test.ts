import { describe, expect, it } from 'vitest';
import type { MetricEntry } from '@caltracker/shared';
import { clientEditKind, earlierEntries, lastValueLine, metricHistory, metricRows, metricSourceLabel, metricsTile, sparklinePoints } from './metrics-view';

const TODAY = '2026-11-19';
const e = (over: Partial<MetricEntry>): MetricEntry => ({
  origin: 'body_metrics', id: 'x', metricKey: 'weight_kg', value: 70, measuredOn: '2026-11-10', measuredAt: null,
  createdAt: '2026-11-10T09:00:00Z', source: 'manual', enteredBy: 'client', externalId: null, ...over,
});

describe('source labels', () => {
  it('names who or what each value came from', () => {
    expect(metricSourceLabel(e({}), 'Luis')).toBe('logged by you');
    expect(metricSourceLabel(e({ enteredBy: 'coach' }), 'Luis')).toBe('logged by Luis');
    expect(metricSourceLabel(e({ enteredBy: 'coach' }), null)).toBe('logged by your coach');
    expect(metricSourceLabel(e({ origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' }), 'Luis')).toBe('InBody scan');
    expect(metricSourceLabel(e({ source: 'apple_health', externalId: 'hk' }), 'Luis')).toBe('from Apple Health');
  });
});

describe('what the client may change', () => {
  it('their own entries, and their weigh-ins from before Metrics', () => {
    expect(clientEditKind(e({}))).toBe('metric');
    expect(clientEditKind(e({ origin: 'body_measurements' }))).toBe('weighin');
  });
  it('not the coach’s, scans or Apple Health', () => {
    expect(clientEditKind(e({ enteredBy: 'coach' }))).toBe(null);
    expect(clientEditKind(e({ origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' }))).toBe(null);
    expect(clientEditKind(e({ origin: 'body_measurements', enteredBy: 'coach' }))).toBe(null);
    expect(clientEditKind(e({ source: 'apple_health', externalId: 'hk' }))).toBe(null);
  });
});

describe('rows', () => {
  const entries = [
    e({ id: 'a', value: 72, measuredOn: '2026-10-01' }),
    e({ id: 'b', value: 70, measuredOn: TODAY }),
    e({ id: 'c', metricKey: 'body_fat_pct', value: 24.1, measuredOn: '2026-11-12', origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' }),
    e({ id: 'd', metricKey: 'waist_cm', value: 78, measuredOn: '2026-11-12', enteredBy: 'coach' }),
  ];
  it('shows all six, with latest, unit, meta and change in the client’s units', () => {
    const rows = metricRows(entries, '3m', 'lb', TODAY, 'Luis');
    expect(rows.map((r) => r.key)).toEqual(['weight_kg', 'body_fat_pct', 'smm_kg', 'vo2_max', 'waist_cm', 'resting_hr_bpm']);
    expect(rows[0]).toMatchObject({ value: '154.3', unit: 'lb', meta: 'Today · logged by you', change: '−4.4 lb' });
    expect(rows[0].points).toHaveLength(2);
    expect(rows[1]).toMatchObject({ value: '24.1', unit: '%', change: null });
    expect(rows[1].meta).toMatch(/InBody scan$/);
    expect(rows[4]).toMatchObject({ value: '30.7', unit: 'in' });
    expect(rows[4].meta).toMatch(/logged by Luis$/);
    expect(rows[5]).toMatchObject({ value: '', unit: 'bpm', meta: 'Not logged yet', change: null, latest: null });
  });
  it('keeps the latest value when the range has none', () => {
    const rows = metricRows([e({ value: 70, measuredOn: '2025-01-01' })], '3m', 'kg', TODAY, null);
    expect(rows[0]).toMatchObject({ value: '70.0', unit: 'kg', change: null, points: [] });
  });
});

describe('history, last value and the Progress tile', () => {
  it('lists one metric newest first', () => {
    const h = metricHistory([e({ id: 'old', measuredOn: '2026-01-01' }), e({ id: 'new', measuredOn: '2026-11-01' }), e({ id: 'bf', metricKey: 'body_fat_pct' })], 'weight_kg');
    expect(h.map((x) => x.id)).toEqual(['new', 'old']);
  });
  it('says the last value and where it came from', () => {
    const line = lastValueLine([e({ value: 70.5, measuredOn: '2026-11-12', origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' })], 'weight_kg', 'kg', TODAY, 'Luis');
    expect(line).toMatch(/^Last: 70\.5 kg on .+ \(InBody scan\)$/);
    expect(lastValueLine([], 'vo2_max', 'kg', TODAY, null)).toBe(null);
  });
  it('the tile shows the latest weight and its 3-month change', () => {
    expect(metricsTile([], 'kg', TODAY)).toEqual({ value: 'Log a metric', sub: 'no weigh-ins yet' });
    expect(metricsTile([e({ value: 70, measuredOn: TODAY })], 'kg', TODAY)).toEqual({ value: '70.0 kg', sub: 'latest weigh-in' });
    expect(metricsTile([e({ id: 'a', value: 72, measuredOn: '2026-10-01' }), e({ id: 'b', value: 70, measuredOn: TODAY })], 'kg', TODAY)).toEqual({
      value: '70.0 kg',
      sub: '−2.0 kg in 3 months',
    });
  });
});

describe('sparkline', () => {
  it('scales points into the box, highest at the top', () => {
    expect(sparklinePoints([{ date: '2026-01-01', value: 10 }, { date: '2026-01-02', value: 20 }], 100, 20, 0)).toBe('0,20 100,0');
    expect(sparklinePoints([{ date: '2026-01-01', value: 5 }, { date: '2026-01-02', value: 5 }], 100, 20, 0)).toBe('0,10 100,10');
    expect(sparklinePoints([{ date: '2026-01-01', value: 5 }], 100, 20)).toBe('');
  });
});

describe('earlier entries', () => {
  it('leaves out the latest, which the row already shows', () => {
    const latest = e({ id: 'new', measuredOn: '2026-11-19', source: 'apple_health', externalId: 'hk' });
    const all = [latest, e({ id: 'old', measuredOn: '2026-11-01' }), e({ id: 'bf', metricKey: 'body_fat_pct' })];
    expect(earlierEntries(all, 'weight_kg', latest).map((x) => x.id)).toEqual(['old']);
    expect(earlierEntries([latest], 'weight_kg', latest)).toEqual([]);
  });
  it('keeps a scan value that shares its id with another metric', () => {
    const scanWeight = e({ id: 's', origin: 'body_measurements', source: 'inbody_scan', enteredBy: 'coach' });
    const scanFat = { ...scanWeight, metricKey: 'body_fat_pct' as const };
    expect(earlierEntries([scanWeight, scanFat], 'body_fat_pct', scanWeight)).toEqual([scanFat]);
  });
});
