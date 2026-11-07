import { diffDays } from '@caltracker/shared';
import type { AttentionGroup, AttentionReason, IsoDate } from '@caltracker/shared';

/**
 * Home's "Needs attention" as one list: every client once, with their most urgent reason first. The reasons come from
 * the shared daily check (`checkClients` then `attentionGroups`) plus "body scan due"; nothing here re-derives them.
 */

/** A daily-check problem (new bests are a celebration, never a problem), or a body scan 30+ days ago. */
export type HomeReason =
  | Exclude<AttentionReason, { kind: 'new_bests' }>
  | { kind: 'scan_due'; lastScanOn: IsoDate | null };
export type HomeReasonKind = HomeReason['kind'];

/** Most urgent first: misses, then plans running out, then quiet, then scans. */
export const REASON_RANK: readonly HomeReasonKind[] = ['missed_in_a_row', 'missed', 'program_ending', 'nothing_planned', 'quiet', 'scan_due'];

export type AttentionEntry = { clientId: string; reasons: HomeReason[] };

/** The filter chips. "Nothing planned" and "quiet" only show under All. */
export type AttentionFilter = 'all' | 'missed' | 'plan' | 'scan';
export const FILTER_LABEL: Record<AttentionFilter, string> = { all: 'All', missed: 'Missed', plan: 'Plan ending', scan: 'Scan due' };

export function filterOf(kind: HomeReasonKind): Exclude<AttentionFilter, 'all'> | null {
  switch (kind) {
    case 'missed_in_a_row':
    case 'missed':
      return 'missed';
    case 'program_ending':
      return 'plan';
    case 'scan_due':
      return 'scan';
    case 'nothing_planned':
    case 'quiet':
      return null;
  }
}

/**
 * One entry per client, most urgent client first. `groups` is `attentionGroups(checkClients(...))`: already in reason
 * order and, within a reason, most pressing first, so a client's place is where their most urgent reason puts them.
 * `scansDue` (oldest scan first) adds a scan reason; clients listed only for a scan come last. A client training right
 * now (`trainingIds`) is never "quiet": they are working out as the coach looks.
 */
export function attentionEntries(
  groups: readonly AttentionGroup[],
  scansDue: ReadonlyArray<{ clientId: string; lastScanOn: IsoDate | null }>,
  trainingIds: ReadonlySet<string> = new Set(),
): AttentionEntry[] {
  const byClient = new Map<string, HomeReason[]>();
  const add = (clientId: string, reason: HomeReason) => {
    const list = byClient.get(clientId);
    if (list) list.push(reason);
    else byClient.set(clientId, [reason]);
  };
  const rank = (k: HomeReasonKind) => REASON_RANK.indexOf(k);
  const ordered = [...groups].sort((a, b) => rank(a.kind as HomeReasonKind) - rank(b.kind as HomeReasonKind));
  for (const g of ordered) {
    for (const item of g.items) {
      if (item.reason.kind === 'new_bests') continue;
      if (item.reason.kind === 'quiet' && trainingIds.has(item.clientId)) continue;
      add(item.clientId, item.reason);
    }
  }
  for (const s of scansDue) add(s.clientId, { kind: 'scan_due', lastScanOn: s.lastScanOn });
  return [...byClient].map(([clientId, reasons]) => ({ clientId, reasons: reasons.sort((a, b) => rank(a.kind) - rank(b.kind)) }));
}

/** How many clients each chip lists. A client counts under every chip one of their reasons belongs to. */
export function attentionCounts(entries: readonly AttentionEntry[]): Record<AttentionFilter, number> {
  const counts: Record<AttentionFilter, number> = { all: entries.length, missed: 0, plan: 0, scan: 0 };
  for (const e of entries) {
    const filters = new Set(e.reasons.map((r) => filterOf(r.kind)));
    for (const f of filters) if (f) counts[f] += 1;
  }
  return counts;
}

export type AttentionRow = { clientId: string; reason: HomeReason; more: number };

/** The rows a chip shows: the client's most urgent reason (of that chip's kind, when filtered) and how many more. */
export function attentionRows(entries: readonly AttentionEntry[], filter: AttentionFilter): AttentionRow[] {
  return entries.flatMap((e) => {
    const reason = filter === 'all' ? e.reasons[0] : e.reasons.find((r) => filterOf(r.kind) === filter);
    return reason ? [{ clientId: e.clientId, reason, more: e.reasons.length - 1 }] : [];
  });
}

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });

/** "today", "yesterday", "tomorrow", "Thursday", or "last/next Thursday" a week away. */
export function dayWord(date: IsoDate, today: IsoDate): string {
  const d = diffDays(today, date);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  const name = weekday.format(new Date(`${date}T00:00:00Z`));
  if (d <= -7) return `last ${name}`;
  if (d >= 7) return `next ${name}`;
  return name;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The plain-language line under the client's name. */
export function reasonLine(r: HomeReason, today: IsoDate): string {
  switch (r.kind) {
    case 'missed_in_a_row':
      return `Missed ${r.count} workouts in a row`;
    case 'missed':
      return r.count === 1 ? `Missed ${dayWord(r.lastMissedOn, today)}` : `Missed ${r.count} workouts in the last 7 days`;
    case 'program_ending':
      return `Program ends ${dayWord(r.endDate, today)} · nothing after`;
    case 'nothing_planned':
      return 'Nothing planned in the next 7 days';
    case 'quiet':
      return `No workout in ${r.days}${r.atLeast ? '+' : ''} days`;
    case 'scan_due':
      return r.lastScanOn === null ? 'No body scan yet' : `Last body scan ${plural(diffDays(r.lastScanOn, today), 'day', 'days')} ago`;
  }
}

/** True for the reasons shown in the warning colour (a missed workout); the rest are reminders. */
export const isUrgent = (r: HomeReason): boolean => r.kind === 'missed' || r.kind === 'missed_in_a_row';

export type FixAction = { label: string; href: string; ariaLabel: string };

/** The one button that fixes it: Message a client who missed or went quiet, Assign when the plan runs out, Add scan. */
export function fixFor(r: HomeReason, clientId: string, name: string): FixAction {
  switch (r.kind) {
    case 'missed_in_a_row':
    case 'missed':
    case 'quiet':
      return { label: 'Message', href: `/messages/${clientId}`, ariaLabel: `Message ${name}` };
    case 'program_ending':
    case 'nothing_planned':
      return { label: 'Assign', href: `/clients/${clientId}/training`, ariaLabel: `Assign to ${name}` };
    case 'scan_due':
      return { label: 'Add scan', href: `/clients/${clientId}/body?scan=1`, ariaLabel: `Add a scan for ${name}` };
  }
}
