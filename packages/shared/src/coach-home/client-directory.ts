import { addDays, diffDays, startOfWeek } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { compareByLastName } from '../names';
import { checkClients } from './daily-check';
import type { CheckAssignment, ClientCheck } from './daily-check';
import { workoutStatus } from './home';
import type { HomeClient, HomeWorkout } from './home';

/**
 * The Clients list (one row per current client): a one-line status, the last workout, this week, the last four weeks'
 * completion and what is planned. It builds on the daily check (`checkClients`), so "Plan ending" and "Nothing
 * planned" mean exactly what they mean on Home.
 *
 * Every date is a calendar date in the coach's own time zone (`today` is the coach's today).
 */

/** "4 weeks" covers the 28 days before today, plus today's workouts once they are done. */
export const COMPLETION_WINDOW_DAYS = 28;

/** A planned workout as the list sees it: `assignmentId` is null for a single workout (not from a program). */
export type DirectoryWorkout = HomeWorkout & { assignmentId: string | null };
/** `lastWorkoutName` is the name of the workout behind `lastFinishedOn`. */
export type DirectoryClient = HomeClient & { lastWorkoutName: string | null };

export type DirectoryInput = {
  clients: DirectoryClient[];
  /** Planned workouts covering at least the last 28 days and the days ahead the list should look for a single workout. */
  workouts: DirectoryWorkout[];
  assignments: CheckAssignment[];
  today: IsoDate;
  timeZone: string;
  /** How far back `lastFinishedOn` was looked for. */
  lookbackDays?: number;
};

/** The status line, most pressing first: training now, missed this week, plan ending, nothing planned, active. */
export type DirectoryStatus =
  | { kind: 'training' }
  | { kind: 'missed'; count: number }
  | { kind: 'plan_ending'; endDate: IsoDate }
  | { kind: 'nothing_planned' }
  | { kind: 'active' };

export type DirectoryPlan =
  /** The program running today, or else the next one. `endingSoon`: it ends within 7 days and nothing follows. */
  | { kind: 'program'; name: string; endDate: IsoDate; endingSoon: boolean }
  /** No program: the next single workout still to do, today or later. */
  | { kind: 'single'; name: string; on: IsoDate }
  | null;

export type DirectoryRow = {
  clientId: string;
  firstName: string;
  lastName: string;
  joinedOn: IsoDate;
  status: DirectoryStatus;
  /** What the filter chips count. A client can be in more than one. */
  flags: { missed: boolean; planEnding: boolean; nothingPlanned: boolean };
  lastWorkout: { on: IsoDate; name: string | null } | null;
  /** Monday to Sunday: done of planned; `missed` are the ones before today not done. */
  week: { done: number; planned: number; missed: number };
  /** Done of due over the last 28 days (plus today's done ones); `percent` is null when nothing was due. */
  fourWeeks: { done: number; due: number; percent: number | null };
  plan: DirectoryPlan;
  check: ClientCheck;
};

export type DirectoryFilter = 'all' | 'missed' | 'plan_ending' | 'nothing_planned' | 'invited';
export type DirectorySort = 'last_workout' | 'name' | 'completion' | 'plan_end';

const isDone = (w: HomeWorkout) => workoutStatus(w).kind === 'done';

function missedThisWeek(workouts: DirectoryWorkout[], today: IsoDate, joinedOn: IsoDate): number {
  const start = startOfWeek(today);
  return workouts.filter((w) => w.scheduledOn >= start && w.scheduledOn < today && w.scheduledOn >= joinedOn && !isDone(w)).length;
}

/** Completion over the last 28 days: only days since they joined count, and today's workouts only once done. */
export function fourWeekCompletion(workouts: readonly HomeWorkout[], today: IsoDate, joinedOn: IsoDate): DirectoryRow['fourWeeks'] {
  const from = addDays(today, -COMPLETION_WINDOW_DAYS);
  let done = 0;
  let due = 0;
  for (const w of workouts) {
    if (w.scheduledOn < from || w.scheduledOn > today || w.scheduledOn < joinedOn) continue;
    const finished = isDone(w);
    if (w.scheduledOn === today && !finished) continue;
    due += 1;
    if (finished) done += 1;
  }
  return { done, due, percent: due === 0 ? null : Math.round((done / due) * 100) };
}

function nextSingle(workouts: DirectoryWorkout[], today: IsoDate): DirectoryPlan {
  const next = workouts
    .filter((w) => w.assignmentId === null && w.scheduledOn >= today && !isDone(w))
    .sort((a, b) => (a.scheduledOn < b.scheduledOn ? -1 : a.scheduledOn > b.scheduledOn ? 1 : a.name.localeCompare(b.name, 'en')))[0];
  return next ? { kind: 'single', name: next.name, on: next.scheduledOn } : null;
}

/** Builds one row per current client, in the daily check's order (by last name). */
export function directoryRows(input: DirectoryInput): DirectoryRow[] {
  const { today } = input;
  const checks = checkClients({
    clients: input.clients,
    workouts: input.workouts,
    assignments: input.assignments,
    prs: [],
    today,
    timeZone: input.timeZone,
    ...(input.lookbackDays === undefined ? {} : { lookbackDays: input.lookbackDays }),
  });
  const byId = new Map(input.clients.map((c) => [c.id, c]));
  const workoutsOf = new Map<string, DirectoryWorkout[]>();
  for (const w of input.workouts) workoutsOf.set(w.clientId, [...(workoutsOf.get(w.clientId) ?? []), w]);

  return checks.flatMap((check) => {
    const client = byId.get(check.clientId);
    if (!client) return [];
    const workouts = workoutsOf.get(client.id) ?? [];
    const ending = check.reasons.find((r) => r.kind === 'program_ending');
    const nothingPlanned = check.reasons.some((r) => r.kind === 'nothing_planned');
    const missed = missedThisWeek(workouts, today, client.joinedOn);
    const training = workouts.some((w) => w.scheduledOn <= today && workoutStatus(w).kind === 'training');

    const status: DirectoryStatus = training
      ? { kind: 'training' }
      : missed > 0
        ? { kind: 'missed', count: missed }
        : ending
          ? { kind: 'plan_ending', endDate: ending.endDate }
          : nothingPlanned
            ? { kind: 'nothing_planned' }
            : { kind: 'active' };

    const plan: DirectoryPlan = check.program
      ? { kind: 'program', name: check.program.name, endDate: check.program.endDate, endingSoon: ending !== undefined }
      : nextSingle(workouts, today);

    return [
      {
        clientId: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        joinedOn: client.joinedOn,
        status,
        flags: { missed: missed > 0, planEnding: ending !== undefined, nothingPlanned },
        lastWorkout: client.lastFinishedOn ? { on: client.lastFinishedOn, name: client.lastWorkoutName } : null,
        week: { ...check.week, missed },
        fourWeeks: fourWeekCompletion(workouts, today, client.joinedOn),
        plan,
        check,
      },
    ];
  });
}

/** Whether a row shows under a filter chip ("invited" is for invites only, so no client matches it). */
export function matchesDirectoryFilter(row: DirectoryRow, filter: DirectoryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'missed':
      return row.flags.missed;
    case 'plan_ending':
      return row.flags.planEnding;
    case 'nothing_planned':
      return row.flags.nothingPlanned;
    case 'invited':
      return false;
  }
}

/** How many clients each chip would show ("invited" is counted by the caller, from the invites). */
export function directoryCounts(rows: readonly DirectoryRow[]): Record<Exclude<DirectoryFilter, 'invited'>, number> {
  return {
    all: rows.length,
    missed: rows.filter((r) => r.flags.missed).length,
    plan_ending: rows.filter((r) => r.flags.planEnding).length,
    nothing_planned: rows.filter((r) => r.flags.nothingPlanned).length,
  };
}

const planEnd = (r: DirectoryRow) => (r.plan?.kind === 'program' ? r.plan.endDate : null);

/** Nulls last; otherwise ascending or descending. */
function nullsLast<T extends string | number>(x: T | null, y: T | null, order: 1 | -1): number {
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return x < y ? -order : order;
}

/**
 * Clients list sort: most recent workout first (never trained last); by last name; lowest 4-week completion first (so
 * whoever is slipping is on top; nothing due last); soonest program end first (no program last). Ties go by name.
 */
export function compareDirectoryRows(sort: DirectorySort) {
  return (a: DirectoryRow, b: DirectoryRow): number => {
    const by =
      sort === 'last_workout'
        ? nullsLast(a.lastWorkout?.on ?? null, b.lastWorkout?.on ?? null, -1)
        : sort === 'completion'
          ? nullsLast(a.fourWeeks.percent, b.fourWeeks.percent, 1)
          : sort === 'plan_end'
            ? nullsLast(planEnd(a), planEnd(b), 1)
            : 0;
    return by || compareByLastName(a, b);
  };
}

/** "Invited today", "Invited yesterday", "Invited 3 days ago" (sentOn is the coach's calendar date of the send). */
export function invitedLabel(sentOn: IsoDate, today: IsoDate): string {
  const days = Math.max(0, diffDays(sentOn, today));
  if (days === 0) return 'Invited today';
  if (days === 1) return 'Invited yesterday';
  return `Invited ${days} days ago`;
}
