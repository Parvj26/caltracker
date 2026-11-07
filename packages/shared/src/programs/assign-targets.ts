import { z } from 'zod';
import { IsoDateSchema, addDays, isoWeekday } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { foldForSearch } from '../coach-home/search';
import type { ProgramClash } from './clashes';

/** Most clients one "Assign" can go to at once (V1 coaches have about 50). */
export const ASSIGN_MAX_CLIENTS = 100;

/** How far ahead nextFreeDay looks before giving up. */
const FREE_DAY_HORIZON = 366;

/**
 * The first day from `from` on with nothing planned in `taken`. A client booked solid for a year gets `from` itself
 * (the workout then goes alongside, after the usual clash warning).
 */
export function nextFreeDay(from: IsoDate, taken: Iterable<IsoDate>): IsoDate {
  const busy = new Set(taken);
  for (let i = 0; i < FREE_DAY_HORIZON; i++) {
    const day = addDays(from, i);
    if (!busy.has(day)) return day;
  }
  return from;
}

/** The Monday after `today` (a week on, when today is a Monday): where a new program starts by default. */
export function nextMonday(today: IsoDate): IsoDate {
  return addDays(today, 8 - isoWeekday(today));
}

/** A single workout on `date` clashes with whatever is already on that day (same shape as programClashes). */
export function workoutClashes(date: IsoDate, existing: readonly { date: IsoDate; name: string }[]): ProgramClash[] {
  const names = existing.filter((w) => w.date === date).map((w) => w.name);
  return names.length > 0 ? [{ date, names }] : [];
}

/**
 * The clients whose "first last" name contains the typed text (case and accents ignored), in the given order, with
 * no cap (the assign picker lists everyone). A blank query keeps everyone.
 */
export function filterClients<T extends { firstName: string; lastName: string }>(clients: readonly T[], query: string): T[] {
  const needle = foldForSearch(query.trim());
  if (needle === '') return [...clients];
  return clients.filter((c) => foldForSearch(`${c.firstName} ${c.lastName}`).includes(needle));
}

/**
 * "Assigned Legs to 3 clients." or "Assigned Legs to 2 of 3 clients. 1 couldn't be assigned." ("Copied …" for
 * Copy to…).
 */
export function assignSummary(name: string, results: readonly { ok: boolean }[], verb: 'Assigned' | 'Copied' = 'Assigned'): string {
  const done = results.filter((r) => r.ok).length;
  const failed = results.length - done;
  const base = verb === 'Assigned' ? 'assign' : 'copy';
  const clients = (n: number) => `${n} ${n === 1 ? 'client' : 'clients'}`;
  if (done === 0) return `Couldn't ${base} ${name}.`;
  if (failed === 0) return `${verb} ${name} to ${clients(done)}.`;
  return `${verb} ${name} to ${done} of ${clients(results.length)}. ${failed} couldn't be ${verb.toLowerCase()}.`;
}

/** Copy to…'s starting day: a week after the workout (so it repeats), but never before today. */
export function copyDefaultDate(workoutDate: IsoDate, today: IsoDate): IsoDate {
  const next = addDays(workoutDate, 7);
  return next < today ? today : next;
}

/**
 * One "Assign" to several clients: a library workout (one day each), a program (a start date each) or, for Copy to…,
 * a client's calendar workout as it is (one day each). Each client
 * has its own new id, made in the browser once per client and day, so a retry repeats the same id and the database
 * copies only once.
 */
export const AssignToClientsInput = z.object({
  kind: z.enum(['workout', 'program', 'copy']),
  sourceId: z.string().uuid(),
  /** The coach's today, from their browser (see date-rules). */
  today: IsoDateSchema,
  targets: z
    .array(z.object({ clientId: z.string().uuid(), id: z.string().uuid(), date: IsoDateSchema }))
    .min(1)
    .max(ASSIGN_MAX_CLIENTS)
    .refine((t) => new Set(t.map((x) => x.clientId)).size === t.length, 'Each client once.')
    .refine((t) => new Set(t.map((x) => x.id)).size === t.length, 'Each id once.'),
});
export type AssignToClientsInput = z.infer<typeof AssignToClientsInput>;
