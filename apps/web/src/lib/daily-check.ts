import { addDays } from '@caltracker/shared';
import type { AttentionKind, AttentionReason, ClientStatus, DailyCheckInput, HomeClient, IsoDate } from '@caltracker/shared';
import type { ChipTone } from '@/components/ui';
import type { HomeData } from './coach-home';

/**
 * Glue between the server's rows and the shared daily-check rules (packages/shared/src/coach-home/daily-check.ts),
 * plus the words Home and the Clients list show for each reason. The rules themselves live only in the shared package.
 */

/** The browser's own calendar date of an instant, as YYYY-MM-DD. */
export function localDateOf(iso: string): IsoDate {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Current clients as the shared rules see them: instants turned into the browser's own dates. */
export function homeClients(data: HomeData): HomeClient[] {
  return data.clients.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    joinedOn: localDateOf(c.joinedAt),
    lastFinishedOn: c.lastFinishedAt ? localDateOf(c.lastFinishedAt) : null,
  }));
}

/** Everything `checkClients` needs, for current clients only, in the coach's time zone. */
export function checkInput(data: HomeData, today: IsoDate, timeZone: string, lookbackDays?: number): DailyCheckInput {
  const clients = homeClients(data);
  const current = new Set(clients.map((c) => c.id));
  return {
    clients,
    workouts: data.workouts.filter((w) => current.has(w.clientId)),
    assignments: data.assignments.filter((a) => current.has(a.clientId)),
    prs: data.prs.filter((p) => current.has(p.clientId)),
    today,
    timeZone,
    ...(lookbackDays === undefined ? {} : { lookbackDays }),
  };
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "Wed 4 Nov", or "yesterday" / "today". */
export function shortDay(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Group headings on Home, in plain words. */
export const GROUP_TITLE: Record<AttentionKind, string> = {
  missed_in_a_row: 'Missed 2+ in a row',
  missed: 'Missed a workout (last 7 days)',
  program_ending: 'Program ending soon',
  nothing_planned: 'Nothing planned',
  quiet: 'No workout in 5+ days',
  new_bests: 'New personal bests this week',
};

/** Anchor ids for the groups (the Home tiles link to some of them). */
export const GROUP_ID: Record<AttentionKind, string> = {
  missed_in_a_row: 'missed-in-a-row',
  missed: 'missed',
  program_ending: 'ending',
  nothing_planned: 'nothing-planned',
  quiet: 'quiet',
  new_bests: 'new-bests',
};

/** The one line a row says about why the client is listed. */
export function reasonText(r: AttentionReason, today: IsoDate): string {
  switch (r.kind) {
    case 'missed_in_a_row':
      return `Missed ${r.count} in a row · latest ${shortDay(r.lastMissedOn, today)}`;
    case 'missed':
      return r.count === 1 ? `Missed 1 · ${shortDay(r.lastMissedOn, today)}` : `Missed ${r.count} · latest ${shortDay(r.lastMissedOn, today)}`;
    case 'program_ending':
      return r.daysLeft === 0 ? 'Ends today' : `Ends in ${plural(r.daysLeft, 'day', 'days')} · ${shortDay(r.endDate, today)}`;
    case 'nothing_planned':
      return 'Nothing in the next 7 days';
    case 'quiet':
      return `No workout in ${r.days}${r.atLeast ? '+' : ''} days`;
    case 'new_bests':
      return `${plural(r.count, 'lift', 'lifts')} improved`;
  }
}

export const STATUS_LABEL: Record<ClientStatus | 'invited', string> = {
  needs_attention: 'Needs attention',
  program_ending: 'Program ending',
  nothing_planned: 'Nothing planned',
  on_track: 'On track',
  invited: 'Invited',
};

/** Chip colours: the words carry the meaning, the colour only supports it. */
export const STATUS_TONE: Record<ClientStatus | 'invited', ChipTone> = {
  needs_attention: 'pink',
  program_ending: 'amber',
  nothing_planned: 'blue',
  on_track: 'lime',
  invited: 'grey',
};
