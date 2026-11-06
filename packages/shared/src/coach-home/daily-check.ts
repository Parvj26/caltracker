import { prsThisWeekByClient } from '../awards/week-prs';
import type { PrEvent } from '../awards/week-prs';
import { addDays, diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { compareByLastName } from '../names';
import type { PersonName } from '../names';
import { LAST_WORKOUT_LOOKBACK_DAYS, endingPrograms, weekProgress, workoutStatus } from './home';
import type { HomeAssignment, HomeClient, HomeWorkout } from './home';

/**
 * The coach's daily check: why a client needs a look today (Home's "Needs attention") and the one-word status on the
 * Clients list. Both come from `checkClients`, so the two pages always agree.
 *
 * Every date here is a calendar date in the coach's own time zone (`today` is the coach's today). Planned workouts
 * carry plain dates, so a workout planned for today is never "missed" while today is still going.
 */

/** Misses count over the last this-many days (yesterday back to 7 days ago). */
export const MISSED_LOOKBACK_DAYS = 7;
/** A run of misses is followed back at most this many days. */
export const MISSED_RUN_LOOKBACK_DAYS = 14;
/** "Nothing planned" looks this many days ahead (today plus the next 7). */
export const PLANNED_AHEAD_DAYS = 7;
/** A client with no finished workout for this many days is "quiet" (the design spec's "no workout in 5+ days"). */
export const QUIET_DAYS = 5;

export type CheckAssignment = HomeAssignment & { programName: string };

export type DailyCheckInput = {
  /** Current clients only. */
  clients: HomeClient[];
  /** Planned workouts covering at least the last 14 and the next 7 days around `today`. */
  workouts: HomeWorkout[];
  assignments: CheckAssignment[];
  prs: PrEvent[];
  /** The coach's today. */
  today: IsoDate;
  /** The coach's time zone, for reading which day a personal best fell on. */
  timeZone: string;
  /** How far back `lastFinishedOn` was looked for (default 30): a client with none in that time is quiet for "at least" that long. */
  lookbackDays?: number;
};

export type AttentionReason =
  /** The latest 2 or more planned workouts were all missed (the latest within the last 7 days). */
  | { kind: 'missed_in_a_row'; count: number; lastMissedOn: IsoDate }
  /** At least one planned workout in the last 7 days was missed (not a run of 2+). */
  | { kind: 'missed'; count: number; lastMissedOn: IsoDate }
  /** The program ends within 7 days and nothing follows it. */
  | { kind: 'program_ending'; assignmentId: string; endDate: IsoDate; daysLeft: number }
  /** No workout still to do today or in the next 7 days (includes clients with no plan at all). */
  | { kind: 'nothing_planned' }
  /** No finished workout for 5+ days (since joining, if never), when no missed workout or empty plan already says why. */
  | { kind: 'quiet'; days: number; atLeast: boolean }
  /** Lifts improved this week: something to celebrate, not a problem. */
  | { kind: 'new_bests'; count: number };
export type AttentionKind = AttentionReason['kind'];

/** Problems first, the celebration last. Home shows its groups in this order. */
export const ATTENTION_ORDER: readonly AttentionKind[] = ['missed_in_a_row', 'missed', 'program_ending', 'nothing_planned', 'quiet', 'new_bests'];

export type ClientStatus = 'needs_attention' | 'program_ending' | 'nothing_planned' | 'on_track';

export type ClientCheck = {
  clientId: string;
  /** In `ATTENTION_ORDER`. Empty when there is nothing to say. */
  reasons: AttentionReason[];
  status: ClientStatus;
  lastWorkoutOn: IsoDate | null;
  /** This week, Monday to Sunday: workouts done of those planned. */
  week: { done: number; planned: number };
  /** The program running today, or else the next one to start. */
  program: { name: string; startDate: IsoDate; endDate: IsoDate } | null;
};

function missedReason(workouts: HomeWorkout[], today: IsoDate, joinedOn: IsoDate): AttentionReason | null {
  const from = addDays(today, -MISSED_RUN_LOOKBACK_DAYS);
  const isDone = (w: HomeWorkout) => workoutStatus(w).kind === 'done';
  // Nothing before the client joined counts: a re-added client had no access to those days.
  const past = workouts
    .filter((w) => w.scheduledOn < today && w.scheduledOn >= from && w.scheduledOn >= joinedOn)
    // Newest day first; within a day, done workouts first, so a day with any workout done breaks the run.
    .sort((a, b) => (a.scheduledOn < b.scheduledOn ? 1 : a.scheduledOn > b.scheduledOn ? -1 : Number(isDone(b)) - Number(isDone(a))));
  const windowStart = addDays(today, -MISSED_LOOKBACK_DAYS);
  const missed = past.filter((w) => w.scheduledOn >= windowStart && !isDone(w));
  const latest = missed[0];
  if (!latest) return null;
  let run = 0;
  for (const w of past) {
    if (isDone(w)) break;
    run += 1;
  }
  // The run starts at the latest past workout: if that one was done there is no run.
  if (run >= 2) return { kind: 'missed_in_a_row', count: run, lastMissedOn: latest.scheduledOn };
  return { kind: 'missed', count: missed.length, lastMissedOn: latest.scheduledOn };
}

function hasSomethingPlanned(workouts: HomeWorkout[], today: IsoDate): boolean {
  const last = addDays(today, PLANNED_AHEAD_DAYS);
  return workouts.some(
    (w) => (w.scheduledOn > today && w.scheduledOn <= last) || (w.scheduledOn === today && workoutStatus(w).kind !== 'done'),
  );
}

/**
 * Programs as they really run: one cancelled from a date ends the day before it (removing a program "from today on"
 * keeps its past days). One cancelled on or before its start is gone.
 */
function effectiveAssignments(assignments: CheckAssignment[]): CheckAssignment[] {
  return assignments.flatMap((a) => {
    if (a.cancelledOn === null) return [a];
    const lastDay = addDays(a.cancelledOn, -1);
    const endDate = lastDay < a.endDate ? lastDay : a.endDate;
    return endDate < a.startDate ? [] : [{ ...a, endDate, cancelledOn: null }];
  });
}

function currentProgram(assignments: CheckAssignment[], today: IsoDate): ClientCheck['program'] {
  const live = assignments.filter((a) => a.endDate >= today);
  const running = live.filter((a) => a.startDate <= today).sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
  const next = live.filter((a) => a.startDate > today).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  const pick = running ?? next;
  return pick ? { name: pick.programName, startDate: pick.startDate, endDate: pick.endDate } : null;
}

function quietReason(client: HomeClient, today: IsoDate, lookbackDays: number): AttentionReason | null {
  if (diffDays(client.joinedOn, today) < QUIET_DAYS) return null;
  const since = diffDays(client.lastFinishedOn ?? client.joinedOn, today);
  if (since < QUIET_DAYS) return null;
  // With no workout inside the loaded window, an older one may exist: say "at least" the window.
  if (client.lastFinishedOn === null && since > lookbackDays) return { kind: 'quiet', days: lookbackDays, atLeast: true };
  return { kind: 'quiet', days: since, atLeast: false };
}

function statusOf(reasons: AttentionReason[]): ClientStatus {
  const has = (k: AttentionKind) => reasons.some((r) => r.kind === k);
  if (has('missed_in_a_row') || has('missed') || has('quiet')) return 'needs_attention';
  if (has('program_ending')) return 'program_ending';
  if (has('nothing_planned')) return 'nothing_planned';
  return 'on_track';
}

/** Checks one client. `input.workouts`, `assignments` and `prs` may hold every client's rows. */
export function checkClient(client: HomeClient, input: DailyCheckInput, bests?: ReadonlyMap<string, number>): ClientCheck {
  const { today } = input;
  const workouts = input.workouts.filter((w) => w.clientId === client.id);
  const assignments = effectiveAssignments(input.assignments.filter((a) => a.clientId === client.id));
  const reasons: AttentionReason[] = [];

  const missed = missedReason(workouts, today, client.joinedOn);
  if (missed) reasons.push(missed);
  const ending = endingPrograms(assignments, today)[0];
  if (ending) {
    reasons.push({ kind: 'program_ending', assignmentId: ending.assignmentId, endDate: addDays(today, ending.daysLeft), daysLeft: ending.daysLeft });
  } else if (!hasSomethingPlanned(workouts, today)) {
    // When the program is ending, "Program ending" already says "plan what's next", so the client is listed once.
    reasons.push({ kind: 'nothing_planned' });
  }
  if (!missed && !reasons.some((r) => r.kind === 'nothing_planned')) {
    const quiet = quietReason(client, today, input.lookbackDays ?? LAST_WORKOUT_LOOKBACK_DAYS);
    if (quiet) reasons.push(quiet);
  }
  const best = (bests ?? prsThisWeekByClient(input.prs, new Set([client.id]), today, input.timeZone)).get(client.id) ?? 0;
  if (best > 0) reasons.push({ kind: 'new_bests', count: best });

  return {
    clientId: client.id,
    reasons,
    status: statusOf(reasons),
    lastWorkoutOn: client.lastFinishedOn,
    week: weekProgress(workouts, today),
    program: currentProgram(assignments, today),
  };
}

/** Checks every client, sorted by last name (ties keep the input order), so every list built from it is stable. */
export function checkClients(input: DailyCheckInput): ClientCheck[] {
  const bests = prsThisWeekByClient(input.prs, new Set(input.clients.map((c) => c.id)), input.today, input.timeZone);
  return [...input.clients].sort(compareByLastName).map((c) => checkClient(c, input, bests));
}

export type AttentionGroup = { kind: AttentionKind; items: Array<{ clientId: string; reason: AttentionReason }> };

const urgency = (r: AttentionReason): number => {
  switch (r.kind) {
    case 'missed_in_a_row':
    case 'missed':
      return -r.count;
    case 'program_ending':
      return r.daysLeft;
    case 'new_bests':
      return -r.count;
    case 'quiet':
      return -r.days;
    case 'nothing_planned':
      return 0;
  }
};

/**
 * Home's "Needs attention": one group per reason, in `ATTENTION_ORDER`, empty groups left out. Within a group the
 * most pressing comes first (longest run or most misses, soonest end, most bests); ties keep the input order.
 */
export function attentionGroups(checks: readonly ClientCheck[]): AttentionGroup[] {
  return ATTENTION_ORDER.flatMap((kind) => {
    const items = checks.flatMap((c) => c.reasons.filter((r) => r.kind === kind).map((reason) => ({ clientId: c.clientId, reason })));
    items.sort((a, b) => urgency(a.reason) - urgency(b.reason));
    return items.length ? [{ kind, items }] : [];
  });
}

export type ClientSort = 'name' | 'last_workout' | 'end_date';

/**
 * Clients list sort: by last name; by most recent workout (never trained last); or by soonest program end (no program
 * last). Ties fall back to the name.
 */
export function compareClientChecks(sort: ClientSort) {
  return (a: PersonName & { check: ClientCheck }, b: PersonName & { check: ClientCheck }): number => {
    const byName = compareByLastName(a, b);
    if (sort === 'last_workout') {
      const x = a.check.lastWorkoutOn;
      const y = b.check.lastWorkoutOn;
      if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? 1 : -1;
    }
    if (sort === 'end_date') {
      const x = a.check.program?.endDate ?? null;
      const y = b.check.program?.endDate ?? null;
      if (x !== y) return x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
    }
    return byName;
  };
}

/**
 * "Today", "Yesterday", "3 days ago", "2 weeks ago". With no workout inside the `lookbackDays` the page loaded, it
 * says "None yet" for a client who joined inside that window and "Over N days ago" otherwise.
 */
export function lastWorkoutLabel(lastOn: IsoDate | null, today: IsoDate, joinedOn: IsoDate, lookbackDays: number): string {
  if (lastOn === null) return diffDays(joinedOn, today) <= lookbackDays ? 'None yet' : `Over ${lookbackDays} days ago`;
  const days = Math.max(0, diffDays(lastOn, today));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
}
