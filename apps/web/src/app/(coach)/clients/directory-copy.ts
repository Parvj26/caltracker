import { diffDays, lastWorkoutLabel } from '@caltracker/shared';
import type { DirectoryPlan, DirectoryRow, DirectoryStatus, IsoDate } from '@caltracker/shared';
import { formatDayMonth, formatShortDay, formatWeekday } from '@/components/calendar/format';

// The words on the Clients list. The rules behind them (status, misses, completion) live in packages/shared
// (coach-home/client-directory.ts); this file only turns them into text.

/** Below this 4-week completion the bar turns magenta. */
export const LOW_COMPLETION_PERCENT = 60;

const longWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' });

/** "today", "tomorrow", a weekday within the week ("Fri" or "Friday"), else "29 Nov". */
export function relativeDay(date: IsoDate, today: IsoDate, long = false): string {
  const days = diffDays(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return long ? longWeekday.format(new Date(`${date}T00:00:00Z`)) : formatWeekday(date);
  return formatDayMonth(date);
}

export function statusText(status: DirectoryStatus, today: IsoDate): string {
  switch (status.kind) {
    case 'training':
      return 'Training now';
    case 'missed':
      return `Missed ${status.count} this week`;
    case 'plan_ending':
      return `Plan ends ${relativeDay(status.endDate, today, true)}`;
    case 'nothing_planned':
      return 'Nothing planned';
    case 'active':
      return 'Active';
  }
}

/** "Today · Upper/Core", "5 days ago · Full Body B", or "None yet". */
export function lastWorkoutText(row: Pick<DirectoryRow, 'lastWorkout' | 'joinedOn'>, today: IsoDate, lookbackDays: number): string {
  const label = lastWorkoutLabel(row.lastWorkout?.on ?? null, today, row.joinedOn, lookbackDays);
  return row.lastWorkout?.name ? `${label} · ${row.lastWorkout.name}` : label;
}

/** The Plan column's two lines: what, then when. Null with nothing planned. */
export function planLines(plan: DirectoryPlan, today: IsoDate): { title: string; detail: string; warn: boolean } | null {
  if (!plan) return null;
  if (plan.kind === 'program') {
    const ends = `ends ${relativeDay(plan.endDate, today)}`;
    return { title: plan.name, detail: plan.endingSoon ? `${ends} · nothing after` : ends, warn: plan.endingSoon };
  }
  return { title: `Single workout: ${plan.name}`, detail: formatShortDay(plan.on), warn: false };
}
