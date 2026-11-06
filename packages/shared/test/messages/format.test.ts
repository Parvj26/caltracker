import { describe, expect, it } from 'vitest';
import { dayLabel, messageYoutubeIds } from '../../src/messages/format';

const NOW = '2026-11-05T12:00:00Z';

describe('dayLabel', () => {
  it('says Today and Yesterday', () => {
    expect(dayLabel('2026-11-05T08:00:00Z', NOW, 'Europe/London')).toBe('Today');
    expect(dayLabel('2026-11-04T23:00:00Z', NOW, 'Europe/London')).toBe('Yesterday');
  });
  it('uses the time zone at midnight', () => {
    // 23:30Z on the 4th is already the 5th in Auckland (UTC+13), but still the 4th in London
    const now = '2026-11-05T05:00:00Z';
    expect(dayLabel('2026-11-04T23:30:00Z', now, 'Pacific/Auckland')).toBe('Today');
    expect(dayLabel('2026-11-04T23:30:00Z', now, 'Europe/London')).toBe('Yesterday');
    // 00:30Z on the 5th is still the 4th in New York
    expect(dayLabel('2026-11-05T00:30:00Z', NOW, 'America/New_York')).toBe('Yesterday');
  });
  it('formats older days in the same year', () => {
    expect(dayLabel('2026-11-02T10:00:00Z', NOW, 'Europe/London')).toBe('Mon 2 Nov');
    expect(dayLabel('2026-11-03T10:00:00Z', NOW, 'Europe/London')).toBe('Tue 3 Nov');
  });
  it('adds the year for a previous year', () => {
    expect(dayLabel('2025-12-31T10:00:00Z', NOW, 'Europe/London')).toBe('Wed 31 Dec 2025');
  });
  it('handles yesterday across a year boundary', () => {
    expect(dayLabel('2025-12-31T10:00:00Z', '2026-01-01T10:00:00Z', 'Europe/London')).toBe('Yesterday');
  });
});

describe('messageYoutubeIds', () => {
  it('finds links in free text, in order, deduped', () => {
    const body =
      'Watch https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=abcdefghijk, again youtu.be/dQw4w9WgXcQ.';
    expect(messageYoutubeIds(body)).toEqual(['dQw4w9WgXcQ', 'abcdefghijk']);
  });
  it('ignores other links and plain text', () => {
    expect(messageYoutubeIds('see https://example.com/watch?v=dQw4w9WgXcQ')).toEqual([]);
    expect(messageYoutubeIds('')).toEqual([]);
  });
});
