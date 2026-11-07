import { describe, expect, it } from 'vitest';
import { parseTargetsForm, weekFromParam } from './week';

describe('weekFromParam', () => {
  it('starts on the Monday of the given day, or of today', () => {
    expect(weekFromParam('2026-11-05', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam(undefined, '2026-11-07')).toBe('2026-11-02');
  });
  it('ignores a malformed, impossible or future week', () => {
    expect(weekFromParam('nope', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam('2026-02-31', '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam(['2026-10-01'], '2026-11-07')).toBe('2026-11-02');
    expect(weekFromParam('2026-11-20', '2026-11-07')).toBe('2026-11-02');
  });
});

describe('parseTargetsForm', () => {
  it('reads each target, blank as none', () => {
    expect(parseTargetsForm({ calories: '2000', protein: '150.5', carbs: '', fat: ' ' })).toEqual({
      ok: true,
      value: { calories: 2000, protein: 150.5, carbs: null, fat: null },
    });
  });
  it('reports every bad value', () => {
    expect(parseTargetsForm({ calories: 'x', protein: '2000', carbs: '', fat: '' })).toEqual({
      ok: false,
      errors: { calories: 'Enter calories as a number.', protein: 'Protein can be at most 1,000 g.' },
    });
  });
  it('treats missing fields as blank', () => {
    expect(parseTargetsForm({})).toEqual({ ok: true, value: { calories: null, protein: null, carbs: null, fat: null } });
  });
});
