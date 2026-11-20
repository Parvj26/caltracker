import { formatPlainDay } from '../dates/format';
import type { IsoDate } from '../dates/dates';
import { copyName } from './duplicate';

/**
 * Names for saving a client's calendar workout to the Library ("Save to Library" in its ⋯ menu). Pure.
 */

/** How names compare in the Library: case, outer spaces and runs of spaces don't count ("Monday  upper" = "Monday Upper"). */
export function libraryNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

/** True when `name` is already used by one of `names` (see libraryNameKey). */
export function libraryNameTaken(name: string, names: Iterable<string>): boolean {
  const key = libraryNameKey(name);
  for (const n of names) if (libraryNameKey(n) === key) return true;
  return false;
}

/**
 * The name offered when a workout's own name is taken: "<name> (<client first name>, <day>)", like a program day's
 * copy ("<name> (Week 1, Day 3)"), shortened to fit 100 characters. "Monday Upper (Vaishali, Fri 20 Nov)".
 */
export function clientCopyName(name: string, firstName: string, date: IsoDate): string {
  const who = firstName.trim();
  return copyName(name, 100, ` (${who ? `${who}, ` : ''}${formatPlainDay(date)})`);
}
