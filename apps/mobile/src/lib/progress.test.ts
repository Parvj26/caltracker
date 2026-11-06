import { describe, expect, it } from 'vitest';
import { buildProgress, stepWeightDate, parseCachedProgress, serializeProgress, type ProgressRows, type ScanRow } from './progress';

const scan = (id: string, measuredOn: string, weightKg: number, extra: Partial<ScanRow> = {}): ScanRow => ({
  id,
  measuredOn,
  createdAt: `${measuredOn}T08:00:00Z`,
  source: 'coach',
  attachmentPath: null,
  values: { weight_kg: weightKg },
  ...extra,
});

const TODAY = '2026-11-05';
const rows = (scans: ScanRow[]): ProgressRows => ({ scans, customs: [] });

describe('buildProgress', () => {
  it('draws a chart only for a measure with two or more points, newest value last', () => {
    const p = buildProgress(rows([scan('b', '2026-11-01', 80), scan('a', '2026-10-01', 82)]), '1y', 'kg', TODAY);
    expect(p.charts).toHaveLength(1);
    expect(p.charts[0].title).toBe('Weight');
    expect(p.charts[0].points.map((x) => x.value)).toEqual([82, 80]);
  });

  it('has no chart with a single scan, and says nothing is hidden', () => {
    const p = buildProgress(rows([scan('a', '2026-11-01', 80)]), '1y', 'kg', TODAY);
    expect(p.charts).toEqual([]);
    expect(p.hiddenByRange).toBe(0);
  });

  it('gives a text summary with the latest value and the change, in the viewer unit', () => {
    const p = buildProgress(rows([scan('a', '2026-10-06', 82), scan('b', '2026-11-01', 80)]), '1y', 'kg', TODAY);
    expect(p.charts[0].summary).toBe('Weight, 80 kg on 1 Nov. −2 since 6 Oct. 2 points.');
    const lb = buildProgress(rows([scan('a', '2026-10-06', 82), scan('b', '2026-11-01', 80)]), '1y', 'lb', TODAY);
    expect(lb.charts[0].summary).toContain('176.4 lb');
  });

  it('counts measures that only have a trend outside the chosen range', () => {
    const old = [scan('a', '2025-01-01', 90), scan('b', '2025-02-01', 89)];
    const p = buildProgress(rows(old), '3m', 'kg', TODAY);
    expect(p.charts).toEqual([]);
    expect(p.hiddenByRange).toBe(1);
    expect(buildProgress(rows(old), 'all', 'kg', TODAY).hiddenByRange).toBe(0);
  });

  it('lists history newest first; only the client own entries can be changed', () => {
    const p = buildProgress(
      rows([
        scan('a', '2026-10-01', 82, { source: 'client' }),
        scan('b', '2026-11-01', 80, { values: { weight_kg: 80, body_fat_pct: 18.24 }, attachmentPath: 'x' }),
      ]),
      '1y',
      'kg',
      TODAY,
    );
    expect(p.history.map((h) => h.id)).toEqual(['b', 'a']);
    expect(p.history[0]).toMatchObject({ mine: false, hasPrintout: true, date: '1 Nov' });
    expect(p.history[0].values).toEqual(['Weight 80 kg', 'Body fat 18.2%']);
    expect(p.history[1].mine).toBe(true);
  });

  it('includes a custom measure by name and unit', () => {
    const custom = { id: '11111111-1111-1111-1111-111111111111', name: 'Waist', unit_label: 'cm', min: 40, max: 200 };
    const key = `custom:${custom.id}`;
    const p = buildProgress(
      { scans: [scan('a', '2026-10-01', 80, { values: { [key]: 90 } }), scan('b', '2026-11-01', 80, { values: { [key]: 88 } })], customs: [custom] },
      '1y',
      'kg',
      TODAY,
    );
    expect(p.charts[0].title).toBe('Waist');
    expect(p.charts[0].summary).toContain('88 cm');
  });
});

describe('cached progress', () => {
  it('round-trips', () => {
    const data = rows([scan('a', '2026-10-01', 82)]);
    expect(parseCachedProgress(serializeProgress(data))).toEqual(data);
  });
  it('rejects anything it cannot read', () => {
    expect(parseCachedProgress(null)).toBeNull();
    expect(parseCachedProgress('not json')).toBeNull();
    expect(parseCachedProgress('{"scans":[{"id":1}],"customs":[]}')).toBeNull();
  });
});

describe('stepWeightDate', () => {
  it('steps back and forward by days', () => {
    expect(stepWeightDate('2026-11-05', -1, TODAY)).toBe('2026-11-04');
    expect(stepWeightDate('2026-11-01', 1, TODAY)).toBe('2026-11-02');
    expect(stepWeightDate('2026-03-01', -1, TODAY)).toBe('2026-02-28');
  });
  it('never goes past today', () => {
    expect(stepWeightDate(TODAY, 1, TODAY)).toBe(TODAY);
  });
  it('never goes before the database floor', () => {
    expect(stepWeightDate('2000-01-01', -1, TODAY)).toBe('2000-01-01');
  });
});
