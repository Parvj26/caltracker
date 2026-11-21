import { describe, expect, it } from 'vitest';
import {
  defaultFlagSide,
  flagChipSummary,
  flagHeadline,
  flagPlace,
  flagReminderText,
  flagSidesFor,
  openFlagsNewestFirst,
  resolvedFlags,
  validateFlag,
  type ClientFlag,
} from '../../src/index';

const flag = (over: Partial<ClientFlag>): ClientFlag => ({
  id: crypto.randomUUID(),
  region: 'neck',
  side: 'centre',
  type: 'pain',
  since: '2026-11-20',
  note: '',
  status: 'open',
  resolvedOn: null,
  createdAt: '2026-11-20T10:00:00Z',
  ...over,
});
const neck = flag({ note: 'Stiff after desk work' });
const knee = flag({ region: 'knee', side: 'L', type: 'limitation', since: '2026-09-02', note: 'No deep squats', createdAt: '2026-09-02T10:00:00Z' });
const day = (d: string) => ({ '2026-11-20': '20 Nov', '2026-09-02': '2 Sep' })[d] ?? d;

describe('flag words', () => {
  it('names the place', () => {
    expect(flagPlace(neck)).toBe('Neck');
    expect(flagPlace(knee)).toBe('Left knee');
    expect(flagPlace({ region: 'knee', side: 'both' })).toBe('Both knees');
    expect(flagPlace({ region: null, side: 'centre' })).toBe('General');
  });

  it('writes a headline per type', () => {
    expect(flagHeadline(neck)).toBe('Neck pain');
    expect(flagHeadline({ ...knee, type: 'injury' })).toBe('Left knee injury');
    expect(flagHeadline(knee)).toBe('Left knee: no deep squats');
    expect(flagHeadline({ ...knee, note: '' })).toBe('Left knee limitation');
    // A note moved over from the old free-text field: its first line, as the old chip showed it.
    expect(flagHeadline(flag({ region: null, type: 'limitation', note: '- Left knee: no deep squats.\nLower back: go light' }))).toBe('Left knee: no deep squats');
    expect(flagHeadline(flag({ region: null, type: 'limitation', note: '  ' }))).toBe('General limitation');
  });

  it('keeps an acronym as it is', () => {
    expect(flagHeadline(flag({ region: 'tfl', side: 'R', type: 'limitation', note: 'IT band tight' }))).toBe('Right TFL: IT band tight');
  });
});

describe('order and summaries', () => {
  const resolved = flag({ region: 'lower_back', type: 'pain', status: 'resolved', resolvedOn: '2026-11-01', since: '2026-10-12' });

  it('sorts open flags newest first and leaves out resolved ones', () => {
    expect(openFlagsNewestFirst([knee, resolved, neck]).map((f) => f.id)).toEqual([neck.id, knee.id]);
    expect(resolvedFlags([knee, resolved, neck]).map((f) => f.id)).toEqual([resolved.id]);
  });

  it('breaks a same-day tie by when the flag was added', () => {
    const later = flag({ region: 'calves', side: 'L', createdAt: '2026-11-20T11:00:00Z' });
    expect(openFlagsNewestFirst([neck, later])[0]!.id).toBe(later.id);
  });

  it('feeds the amber chip from open flags', () => {
    expect(flagChipSummary([knee, neck, resolved])).toEqual({ first: 'Neck pain', more: 1 });
    expect(flagChipSummary([resolved])).toBeNull();
  });

  it('writes the builder reminder line, newest first, with dates on pains and injuries', () => {
    expect(flagReminderText('Vaishali', [knee, neck, resolved], day)).toBe('Vaishali: Neck pain (20 Nov) · Left knee: no deep squats');
    expect(flagReminderText('Vaishali', [resolved], day)).toBeNull();
  });
});

describe('sides and checks', () => {
  it('offers the sides a region has', () => {
    expect(flagSidesFor('neck')).toEqual(['L', 'R', 'both', 'centre']);
    expect(flagSidesFor('knee')).toEqual(['L', 'R', 'both']);
    expect(flagSidesFor('abs')).toEqual(['centre']);
    expect(flagSidesFor(null)).toEqual(['centre']);
    expect(defaultFlagSide('neck', 'L')).toBe('centre');
    expect(defaultFlagSide('knee', 'R')).toBe('R');
    expect(defaultFlagSide('knee')).toBe('L');
  });

  it('validates a new flag', () => {
    const ok = validateFlag({ region: 'neck', side: 'centre', type: 'pain', since: '2026-11-20', note: '  Stiff  ' }, '2026-11-20');
    expect(ok).toEqual({ ok: true, value: { region: 'neck', side: 'centre', type: 'pain', since: '2026-11-20', note: 'Stiff' } });
    expect(validateFlag({ region: 'spleen', side: 'L', type: 'pain', since: '2026-11-20', note: '' }, '2026-11-20')).toMatchObject({ ok: false, field: 'region' });
    expect(validateFlag({ region: 'knee', side: 'centre', type: 'pain', since: '2026-11-20', note: '' }, '2026-11-20')).toMatchObject({ ok: false, field: 'side' });
    expect(validateFlag({ region: 'knee', side: 'L', type: 'ache', since: '2026-11-20', note: '' }, '2026-11-20')).toMatchObject({ ok: false, field: 'type' });
    expect(validateFlag({ region: 'knee', side: 'L', type: 'pain', since: '2026-11-21', note: '' }, '2026-11-20')).toMatchObject({ ok: false, field: 'since' });
    expect(validateFlag({ region: 'knee', side: 'L', type: 'pain', since: 'soon', note: '' }, '2026-11-20')).toMatchObject({ ok: false, field: 'since' });
    expect(validateFlag({ region: 'knee', side: 'L', type: 'pain', since: '2026-11-20', note: 'x'.repeat(2001) }, '2026-11-20')).toMatchObject({ ok: false, field: 'note' });
    expect(validateFlag({ region: '', side: 'centre', type: 'limitation', since: '2026-11-20', note: 'General' }, '2026-11-20')).toMatchObject({ ok: true });
  });
});
