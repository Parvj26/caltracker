import { describe, expect, it } from 'vitest';
import { addDays, localDateOf } from '../../src/dates/dates';
import type { IsoDate } from '../../src/dates/dates';
import {
  formatDateTime,
  formatDayDate,
  formatPlainDay,
  formatPlainDayMonth,
  formatPlainDayMonthYear,
  formatPlainLongDay,
  formatRelativeDay,
  formatTimeOfDay,
  formatWeekRange,
  formatWeekdayDay,
} from '../../src/dates/format';
import { foodDayLabel, formatMealTime, mealReference, shortDayLabel } from '../../src/food/food';
import { dayLabel } from '../../src/messages/format';
import { localDay } from '../../src/awards/streak';
import { formatShortDate } from '../../src/body/series';
import { postAge } from '../../src/community/feed';

// Pins every date label the apps print, for a long run of days, so moving the helpers into dates/format.ts can be
// checked byte for byte. Every case names its time zone, so the snapshot is the same under TZ=Pacific/Auckland.

const TODAY: IsoDate = '2026-11-14';
const days = (from: IsoDate, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));
// A year either side of today, plus leap days and the year turn.
const DAYS = [...days('2025-11-01', 460), '2024-02-29', '2028-02-29', '2026-12-31', '2027-01-01'];
const ZONES = ['UTC', 'Europe/London', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'];
const INSTANTS = [
  '2026-11-14T00:30:00Z',
  '2026-11-13T23:30:00Z',
  '2026-11-14T12:00:00Z',
  '2026-11-14T13:05:00Z',
  '2026-11-12T10:00:00Z',
  '2026-09-07T18:45:00Z',
  '2025-12-31T23:59:00Z',
  '2026-03-29T00:30:00Z',
  '2026-11-01T08:59:00Z',
];

describe('pinned date labels', () => {
  it('plain calendar dates', () => {
    const lines = DAYS.map((d) =>
      [
        d,
        formatPlainDay(d),
        formatPlainDayMonth(d),
        formatPlainDayMonthYear(d),
        formatPlainLongDay(d),
        formatWeekdayDay(d),
        formatWeekRange(d),
        formatRelativeDay(d, TODAY),
        foodDayLabel(d, TODAY),
        shortDayLabel(d, TODAY),
        formatShortDate(d, TODAY),
      ].join(' | '),
    );
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('instants in named time zones', () => {
    const lines = ZONES.flatMap((tz) =>
      INSTANTS.map((i) =>
        [
          tz,
          i,
          formatDateTime(i, tz),
          formatTimeOfDay(i, tz),
          formatDayDate(i, tz),
          formatMealTime(i, tz),
          localDay(i, tz),
          localDateOf(i, tz),
          dayLabel(i, '2026-11-14T12:00:00Z', tz),
          dayLabel(i, '2027-01-01T09:00:00Z', tz),
          mealReference({ name: 'Lunch', eatenOn: localDateOf(i, tz), eatenAt: i }, TODAY, tz),
        ].join(' | '),
      ),
    );
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('community post ages match the en-US short date for the viewer\'s zone', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    for (let h = 0; h < 24 * 500; h += 7) {
      const t = now - h * 3_600_000;
      const d = new Date(t);
      const sameYear = d.getFullYear() === new Date(now).getFullYear();
      const expected =
        h * 3600 < 7 * 86400
          ? postAge(new Date(t).toISOString(), now)
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
      expect(postAge(new Date(t).toISOString(), now)).toBe(expected);
    }
  });
});
