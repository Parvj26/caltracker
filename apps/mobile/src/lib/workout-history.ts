// Pure helpers for the History screen: one row per finished workout and the month's summary card. Volume, PR,
// duration and unit wording come from @caltracker/shared; this only puts them together.
import {
  formatLogDuration,
  formatLogVolume,
  liftsImprovedBetween,
  localDateOf,
  type IsoDate,
  type PrEvent,
  type Units,
} from '@caltracker/shared';
import { formatDayLabel, weekdayShort } from './workouts';

/** One finished workout, already summed (logVolumeKg, logDurationS, isLoggedByCoach, awardHasPrs). */
export type HistoryLog = {
  id: string;
  name: string;
  finishedAt: string;
  durationS: number;
  volumeKg: number;
  loggedByCoach: boolean;
  pr: boolean;
};

/** What History saves on the phone, so it opens without signal. */
export type HistoryData = { logs: HistoryLog[]; prs: PrEvent[]; streak: number };

export type HistoryRow = { id: string; dow: string; num: number; name: string; meta: string; pr: boolean; label: string };

export function historyRow(log: HistoryLog, units: Units, coachFirstName: string | null, timeZone: string): HistoryRow {
  const day = localDateOf(log.finishedAt, timeZone);
  const meta = [
    log.loggedByCoach ? `Logged by ${coachFirstName ?? 'your coach'}` : null,
    formatLogDuration(log.durationS),
    log.volumeKg > 0 ? formatLogVolume(log.volumeKg, units) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    id: log.id,
    dow: weekdayShort(day),
    num: Number(day.slice(8, 10)),
    name: log.name,
    meta,
    pr: log.pr,
    label: [log.name, formatDayLabel(day), meta, log.pr ? 'personal record' : null].filter(Boolean).join(', '),
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type MonthSummary = { title: string; workouts: number; time: string; prs: number };

/** This month so far (the month `today` is in, each workout's day read in `timeZone`). */
export function monthSummary(logs: readonly HistoryLog[], prs: readonly PrEvent[], today: IsoDate, timeZone: string): MonthSummary {
  const month = today.slice(0, 7);
  const mine = logs.filter((l) => localDateOf(l.finishedAt, timeZone).startsWith(month));
  const seconds = mine.reduce((s, l) => s + l.durationS, 0);
  return {
    title: `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} so far`,
    workouts: mine.length,
    time: mine.length === 0 ? '0 min' : formatLogDuration(seconds),
    prs: liftsImprovedBetween(prs, `${month}-01`, today, timeZone),
  };
}

const isLog = (v: unknown): v is HistoryLog => {
  const l = v as HistoryLog;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.finishedAt === 'string' &&
    typeof l.durationS === 'number' &&
    typeof l.volumeKg === 'number' &&
    typeof l.loggedByCoach === 'boolean' &&
    typeof l.pr === 'boolean'
  );
};

const isPr = (v: unknown): v is PrEvent => {
  const p = v as PrEvent;
  return typeof v === 'object' && v !== null && typeof p.logId === 'string' && typeof p.exerciseId === 'string' && typeof p.achievedAt === 'string';
};

/** The saved copy, or null when there is none or it is not readable. */
export function parseHistoryCache(raw: string | null): HistoryData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HistoryData>;
    if (!Array.isArray(v.logs) || !v.logs.every(isLog)) return null;
    if (!Array.isArray(v.prs) || !v.prs.every(isPr)) return null;
    return { logs: v.logs, prs: v.prs, streak: typeof v.streak === 'number' ? v.streak : 0 };
  } catch {
    return null;
  }
}
