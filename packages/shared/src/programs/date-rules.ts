import { addDays, diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

// Which dates a coach may put workouts on, measured from the coach's own today (from their browser). The server
// can't know the browser's time zone, so it takes that today from the browser and only checks it is plausible.

/** Programs can be assigned to start up to this many days back (for a client who already began). */
export const PROGRAM_START_DAYS_BACK = 7;

export const PAST_DATE_ERROR = 'Pick today or a later date.';
export const PROGRAM_START_ERROR = 'Programs can start up to 7 days ago.';
export const BAD_TODAY_ERROR = "Your device's date looks wrong. Check it, reload the page and try again.";

/** Every real time zone is within a day of UTC, so a browser "today" further off than that is wrong or made up. */
export function isPlausibleToday(today: IsoDate, utcToday: IsoDate): boolean {
  return Math.abs(diffDays(utcToday, today)) <= 1;
}

/** Single workouts (added or moved) go on today or later. */
export function scheduleDateError(date: IsoDate, today: IsoDate): string | null {
  return date < today ? PAST_DATE_ERROR : null;
}

/** The earliest start date a program may be assigned with. */
export function earliestProgramStart(today: IsoDate): IsoDate {
  return addDays(today, -PROGRAM_START_DAYS_BACK);
}

export function programStartError(start: IsoDate, today: IsoDate): string | null {
  return start < earliestProgramStart(today) ? PROGRAM_START_ERROR : null;
}
