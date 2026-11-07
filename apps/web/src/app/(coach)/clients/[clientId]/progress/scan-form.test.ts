import { describe, expect, it } from 'vitest';
import { inputsFor, parseScanForm, scanFields, type CustomMetric } from './scan-form';

const waist: CustomMetric = { id: '11111111-1111-1111-1111-111111111111', name: 'Waist', unit_label: 'in', min: 15, max: 80, archived_at: null };
const old: CustomMetric = { id: '22222222-2222-2222-2222-222222222222', name: 'Neck', unit_label: '', min: 5, max: 30, archived_at: '2026-01-01T00:00:00Z' };

describe('scanFields', () => {
  it('lists the standard measures, then active custom ones, labelled with the coach units', () => {
    const f = scanFields([waist, old], 'lb');
    expect(f.map((x) => x.label)).toEqual([
      'Weight (lb)', 'Body fat (%)', 'Skeletal muscle mass (lb)', 'Lean body mass (lb)', 'BMI', 'Visceral fat level', 'BMR (kcal)', 'Waist (in)',
    ]);
  });
  it('keeps an archived measure only when the scan has a value for it', () => {
    const f = scanFields([waist, old], 'kg', new Set([`custom:${old.id}`]));
    expect(f.at(-1)).toEqual({ key: `custom:${old.id}`, label: 'Neck' });
  });
});

describe('parseScanForm', () => {
  const customs = [waist];
  const fields = scanFields(customs, 'lb');
  it('converts lb to stored kg and leaves blanks out', () => {
    const r = parseScanForm({ weight_kg: '176.4', body_fat_pct: '18.2', bmi: '' }, fields, customs, 'lb');
    expect(r).toEqual({ ok: true, values: { weight_kg: 80.014, body_fat_pct: 18.2 } });
  });
  it('needs at least one value', () => {
    expect(parseScanForm({ weight_kg: ' ' }, fields, customs, 'lb')).toEqual({ ok: false, errors: {}, form: 'Enter at least one value.' });
  });
  it('reports out-of-range and non-numbers per field, in the coach units', () => {
    const r = parseScanForm({ body_fat_pct: '80', weight_kg: 'abc', [`custom:${waist.id}`]: '5' }, fields, customs, 'lb');
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors.body_fat_pct).toBe('Body fat (%) must be between 2 and 75.');
    expect(r.errors.weight_kg).toBe('Weight (lb): enter a number.');
    expect(r.errors[`custom:${waist.id}`]).toBe('Waist (in) must be between 15 and 80.');
  });
  it('keeps the stored value of a box left as it was', () => {
    const values = { weight_kg: 80.123 };
    const inputs = inputsFor(values, 'lb');
    const r = parseScanForm(inputs, fields, customs, 'lb', { values, inputs });
    expect(r).toEqual({ ok: true, values: { weight_kg: 80.123 } });
  });
});
