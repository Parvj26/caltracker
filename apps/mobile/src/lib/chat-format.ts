// Small pure helpers for how the chat reads on screen.

import { formatTimeOfDay } from '@caltracker/shared';

/** "2:05 pm" in a time zone. Only numbers are taken from Intl (limited locale data on Hermes). */
export function clockTime(iso: string, timeZone: string): string {
  return formatTimeOfDay(iso, timeZone);
}
