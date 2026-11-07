import { describe, expect, it } from 'vitest';
import { formatRange } from './format';

describe('formatRange', () => {
  it('writes the year once, or both years when the range crosses one', () => {
    expect(formatRange('2026-10-26', '2026-11-08')).toBe('26 Oct – 8 Nov 2026');
    expect(formatRange('2026-12-28', '2027-01-10')).toBe('28 Dec 2026 – 10 Jan 2027');
  });
});
