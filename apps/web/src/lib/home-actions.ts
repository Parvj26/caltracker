import type { TodayRow } from '@caltracker/shared';

/** Filled for something to start or carry on, outlined to watch, light to look back. */
export type ActionStyle = 'filled' | 'outlined' | 'light';
export type TodayAction = { label: 'Log session' | 'Continue' | 'Watch' | 'View'; href: string; style: ActionStyle };
export type TodayPill = { label: string; tone: 'idle' | 'live' | 'done' };

/**
 * The one button on a Today row, chosen by the workout's state: log the session when nobody has started, continue the
 * coach's own session, watch the client's live, view the finished log. Message, Assign and Open client sit in "⋯".
 */
export function todayAction(row: TodayRow, coachId: string): TodayAction {
  const client = row.client.id;
  const session = `/clients/${client}/log/${row.workout.id}`;
  switch (row.status.kind) {
    case 'not_started':
      return { label: 'Log session', href: session, style: 'filled' };
    case 'training':
      if (row.status.loggedBy === coachId) return { label: 'Continue', href: session, style: 'filled' };
      return { label: 'Watch', href: `/clients/${client}/logs/${row.status.logId}`, style: 'outlined' };
    case 'done':
      return { label: 'View', href: `/clients/${client}/logs/${row.status.logId}`, style: 'light' };
  }
}

/** The status pill next to the button. */
export function todayPill(row: TodayRow, coachId: string): TodayPill {
  switch (row.status.kind) {
    case 'not_started':
      return { label: 'Not started', tone: 'idle' };
    case 'training':
      return row.status.loggedBy === coachId ? { label: '● You’re logging', tone: 'live' } : { label: '● Live', tone: 'live' };
    case 'done':
      return { label: '✓ Done', tone: 'done' };
  }
}

/** What "⋯" holds on every Today row. */
export function todayMenu(clientId: string): { label: string; href: string }[] {
  return [
    { label: 'Message', href: `/messages/${clientId}` },
    { label: 'Assign', href: `/clients/${clientId}/training` },
    { label: 'Open client', href: `/clients/${clientId}` },
  ];
}
