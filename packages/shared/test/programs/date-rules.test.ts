import { describe, expect, it } from 'vitest';
import {
  BAD_TODAY_ERROR,
  PAST_DATE_ERROR,
  PROGRAM_START_DAYS_BACK,
  PROGRAM_START_ERROR,
  earliestProgramStart,
  isPlausibleToday,
  programStartError,
  scheduleDateError,
} from '../../src/programs/date-rules';

describe('isPlausibleToday', () => {
  it('accepts the browser date when it is within a day of the server UTC date', () => {
    expect(isPlausibleToday('2026-11-05', '2026-11-05')).toBe(true);
    expect(isPlausibleToday('2026-11-06', '2026-11-05')).toBe(true); // Auckland, already tomorrow
    expect(isPlausibleToday('2026-11-04', '2026-11-05')).toBe(true); // Los Angeles, still yesterday
  });

  it('refuses a browser date two or more days away', () => {
    expect(isPlausibleToday('2026-11-07', '2026-11-05')).toBe(false);
    expect(isPlausibleToday('2026-11-03', '2026-11-05')).toBe(false);
    expect(isPlausibleToday('2025-11-05', '2026-11-05')).toBe(false);
  });
});

describe('scheduleDateError (single workouts: today or later)', () => {
  it('allows today and later days', () => {
    expect(scheduleDateError('2026-11-05', '2026-11-05')).toBeNull();
    expect(scheduleDateError('2026-12-01', '2026-11-05')).toBeNull();
  });

  it('refuses yesterday and earlier', () => {
    expect(scheduleDateError('2026-11-04', '2026-11-05')).toBe(PAST_DATE_ERROR);
    expect(PAST_DATE_ERROR).toBe('Pick today or a later date.');
  });
});

describe('programStartError (programs: up to 7 days back)', () => {
  it('is 7 days', () => {
    expect(PROGRAM_START_DAYS_BACK).toBe(7);
    expect(earliestProgramStart('2026-11-05')).toBe('2026-10-29');
  });

  it('allows a start from 7 days ago onwards', () => {
    expect(programStartError('2026-10-29', '2026-11-05')).toBeNull();
    expect(programStartError('2026-11-02', '2026-11-05')).toBeNull();
    expect(programStartError('2026-11-09', '2026-11-05')).toBeNull();
  });

  it('refuses a start 8 or more days ago', () => {
    expect(programStartError('2026-10-28', '2026-11-05')).toBe(PROGRAM_START_ERROR);
    expect(PROGRAM_START_ERROR).toBe('Programs can start up to 7 days ago.');
  });
});

it('has a plain message for a device date that is far off', () => {
  expect(BAD_TODAY_ERROR).toMatch(/date/);
});
