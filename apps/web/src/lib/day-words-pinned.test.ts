import { addDays } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { describe, expect, it } from 'vitest';
import { relativeDay as directoryDay } from '@/app/(coach)/clients/directory-copy';
import { relativeDay } from './client-today';
import { shortDay } from './daily-check';
import { dayWord } from './home-attention';

// Pins the day words on Home, the daily check, the client overview and the Clients list for a run of days around
// today, so the shared helpers behind them can change without changing a single character.
const TODAY: IsoDate = '2026-11-14';
const DAYS = [...Array.from({ length: 400 }, (_, i) => addDays('2026-01-01', i)), '2025-12-31', '2027-09-07'];

describe('pinned day words', () => {
  it('match the snapshot', () => {
    const lines = DAYS.map((d) =>
      [d, directoryDay(d, TODAY), directoryDay(d, TODAY, true), relativeDay(d, TODAY), shortDay(d, TODAY), dayWord(d, TODAY)].join(' | '),
    );
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
