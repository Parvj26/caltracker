import { addDays } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { describe, expect, it } from 'vitest';
import { formatCommentTime } from './active-log-logic';
import { clockTime } from './chat-format';
import { formatDayLabel, formatDayMonth, weekdayShort } from './workouts';
import { selectedHeading, weekTitle } from './workouts-plan';

// Pins the phone's date labels for a run of days, so the shared helpers behind them can change without changing a
// single character. Everything here is free of the phone's own time zone except the comment time, checked by hand.
const TODAY: IsoDate = '2026-11-14';
const DAYS = [...Array.from({ length: 400 }, (_, i) => addDays('2026-01-01', i)), '2025-12-29', '2027-09-07'];

describe('pinned phone date labels', () => {
  it('match the snapshot', () => {
    const lines = DAYS.map((d) => [d, weekdayShort(d), formatDayMonth(d), formatDayLabel(d), weekTitle(d, TODAY), selectedHeading(d, TODAY)].join(' | '));
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('chat clock times', () => {
    const out = ['UTC', 'Pacific/Auckland', 'America/New_York'].flatMap((tz) =>
      ['2026-11-05T14:05:00.000Z', '2026-11-05T00:30:00.000Z', '2026-11-05T12:00:00.000Z', '2026-09-07T23:59:00.000Z'].map((i) => clockTime(i, tz)),
    );
    expect(out).toEqual(['2:05 pm', '12:30 am', '12:00 pm', '11:59 pm', '3:05 am', '1:30 pm', '1:00 am', '11:59 am', '9:05 am', '7:30 pm', '7:00 am', '7:59 pm']);
  });

  it('coach comment times use the phone\'s own date with our month words', () => {
    const iso = '2026-09-07T12:00:00.000Z';
    const d = new Date(iso);
    expect(formatCommentTime(iso).startsWith(`${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} · `)).toBe(true);
  });
});
