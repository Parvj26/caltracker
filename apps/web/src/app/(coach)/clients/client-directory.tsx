'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import {
  buildSmartIndex,
  compareByLastName,
  compareDirectoryRows,
  directoryChip,
  directoryCounts,
  directoryRows,
  invitedLabel,
  invitedShortLabel,
  matchesDirectoryFilter,
  smartFilter,
  smartMatch,
  type DirectoryChip,
  type DirectoryFilter,
  type DirectoryRow,
  type DirectorySort,
  type IsoDate,
} from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { MoreMenu } from '@/components/more-menu';
import { Chip, type ChipTone } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { homeClients, localDateOf } from '@/lib/daily-check';
import { useBrowserToday } from '@/lib/local-today';
import { avatarTone, initials } from './avatar';
import { LOW_COMPLETION_PERCENT, lastWorkoutText, planLines, statusText } from './directory-copy';
import type { ConfirmHandle } from './confirm-button';
import { useResendInvite } from './resend-button';
import { CancelInviteButton } from './row-actions';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

/** What a pending invite starts with when they join (kept with the invite). */
export type InvitePlanSummary =
  | { kind: 'program'; name: string; on: IsoDate }
  | { kind: 'single'; name: string; on: IsoDate; more: number }
  | null;
export type DirectoryInvite = {
  id: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  sentAt: string;
  /** The link has run out (they need a resend). */
  expired: boolean;
  plan: InvitePlanSummary;
};

// "Active" (every joined client) is the default; invites wait under their own chip.
const FILTERS: readonly DirectoryFilter[] = ['active', 'missed', 'invited', 'nothing_planned', 'plan_ending'];
const FILTER_LABEL: Record<DirectoryFilter, string> = {
  active: 'Active',
  missed: 'Missed this week',
  plan_ending: 'Plan ending',
  nothing_planned: 'Nothing planned',
  invited: 'Invited',
};
const SORT_LABEL: Record<DirectorySort, string> = {
  last_workout: 'Last workout',
  name: 'Name',
  completion: '4-week completion',
  plan_end: 'Plan end',
};
const STATUS_CLASS: Record<DirectoryRow['status']['kind'], string | undefined> = {
  training: styles.statusAlert,
  missed: styles.statusAlert,
  plan_ending: styles.statusWarn,
  nothing_planned: styles.statusMuted,
  active: styles.statusGood,
};

/** A phone row's one chip: the words carry the meaning, the colour only supports them. */
const CHIP_VIEW: Record<DirectoryChip['kind'], { tone: ChipTone; text: (c: DirectoryChip) => string }> = {
  missed: { tone: 'pink', text: (c) => `Missed ${c.kind === 'missed' ? c.count : 0}` },
  on_track: { tone: 'lime', text: () => 'On track' },
  nothing_planned: { tone: 'grey', text: () => 'Nothing planned' },
};
/** What the caption above the rows says on a phone ("41 active", "9 invites waiting"). */
const shownCaption = (filter: DirectoryFilter, n: number) =>
  filter === 'invited' ? `${n} ${n === 1 ? 'invite' : 'invites'} waiting` : `${n} ${FILTER_LABEL[filter].toLowerCase()}`;

/** Invites matching the search (shared smart search: typos, partial words, any order) by name, or by their email. */
function searchInvites(invites: readonly DirectoryInvite[], query: string): DirectoryInvite[] {
  if (query.trim() === '') return [...invites];
  const index = buildSmartIndex(invites, (i) => ({ name: i.name, extraWords: [i.email] }));
  return smartMatch(index, query)
    .sort((a, b) => a.tier - b.tier)
    .map((h) => h.item);
}

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" data-avatar="" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

/** A cell's caption, shown only when the table becomes stacked cards (the column headers are hidden then). */
const CardLabel = ({ children }: { children: string }) => (
  <span aria-hidden="true" className={styles.cardLabel}>{children}</span>
);

const Dash = () => (
  <>
    <span aria-hidden="true" className={styles.muted}>—</span>
    <span className={styles.visuallyHidden}>None</span>
  </>
);

function ClientRow({ name, row, today, lookbackDays, id }: { id: string; name: string; row: DirectoryRow | null; today: IsoDate | null; lookbackDays: number }) {
  const plan = row && today ? planLines(row.plan, today) : null;
  const pct = row?.fourWeeks.percent ?? null;
  const chip = row && today ? directoryChip(row) : null;
  return (
    <div role="row" className={cx(styles.row, styles.linkRow)} data-client-id={id}>
      <div role="cell" className={cx(styles.clientCell, styles.cellClient)}>
        <Avatar name={name} toneKey={id} />
        <span className={styles.nameStack}>
          {/* The link covers the whole row (see .rowLink::after), so tapping anywhere opens the client. */}
          <Link href={`/clients/${id}`} className={styles.rowLink}>{name || 'Client'}</Link>
          {row && today ? (
            <span className={cx(styles.statusLine, styles.wideOnly, STATUS_CLASS[row.status.kind])}>
              {row.status.kind === 'training' ? <span aria-hidden="true">● </span> : null}
              {statusText(row.status, today)}
            </span>
          ) : null}
        </span>
        {/* Phones: one chip, then › (or Assign when nothing is planned). */}
        {chip ? (
          <Chip tone={CHIP_VIEW[chip.kind].tone} className={cx(styles.phoneOnly, styles.rowChip)}>
            {CHIP_VIEW[chip.kind].text(chip)}
          </Chip>
        ) : null}
        {chip?.kind === 'nothing_planned' ? (
          <Link href={`/clients/${id}/training?add=program`} className={cx(styles.phoneOnly, styles.quickAssign)} aria-label={`Assign a program to ${name}`}>
            Assign
          </Link>
        ) : (
          <span aria-hidden="true" className={cx(styles.phoneOnly, styles.rowChevron)}>
            <ChevronIcon direction="right" size={18} />
          </span>
        )}
      </div>
      <span role="cell" className={cx(styles.cell, styles.cellLast)}>
        <CardLabel>Last workout</CardLabel>
        {row && today ? lastWorkoutText(row, today, lookbackDays) : null}
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellWeek)}>
        <CardLabel>This week</CardLabel>
        {row ? (
          row.week.planned === 0 ? (
            <Dash />
          ) : (
            <b className={row.week.missed > 0 ? styles.behind : undefined}>{`${row.week.done} of ${row.week.planned}`}</b>
          )
        ) : null}
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellFour)}>
        <CardLabel>4 weeks</CardLabel>
        {row ? (
          pct === null ? (
            <Dash />
          ) : (
            <span className={styles.completion}>
              <span aria-hidden="true" className={styles.bar}>
                <span
                  className={cx(styles.barFill, pct < LOW_COMPLETION_PERCENT && styles.barLow)}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <b>{`${pct}%`}</b>
              <span className={styles.visuallyHidden}>{` (${row.fourWeeks.done} of ${row.fourWeeks.due} done)`}</span>
            </span>
          )
        ) : null}
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellPlan)}>
        <CardLabel>Plan</CardLabel>
        {plan ? (
          <span className={styles.planStack}>
            <span className={styles.planTitle} title={plan.title}>{plan.title}</span>
            <span className={cx(styles.planDetail, plan.warn && styles.planWarn)}>{plan.detail}</span>
          </span>
        ) : row && today ? (
          <span className={styles.planEmpty}>
            <span className={styles.muted}>Nothing planned</span>
            <span className={styles.planButtons}>
              <Link href={`/clients/${id}/training?add=workout`} className={styles.miniButton} aria-label={`Add a workout for ${name}`}>
                + Workout
              </Link>
              <Link href={`/clients/${id}/training?add=program`} className={styles.miniButton} aria-label={`Assign a program to ${name}`}>
                + Program
              </Link>
            </span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

function InviteRow({ invite, today }: { invite: DirectoryInvite; today: IsoDate | null }) {
  const { expired } = invite;
  const plan = invite.plan;
  const { resend, pending, message } = useResendInvite(invite);
  const cancelRef = useRef<ConfirmHandle>(null);
  const resendLabel = pending ? 'Sending…' : 'Resend';
  return (
    <div role="row" className={styles.row} data-invite-id={invite.id}>
      <div role="cell" className={cx(styles.clientCell, styles.cellClient)}>
        <Avatar name={invite.name} toneKey={invite.email} />
        <span className={styles.nameStack}>
          <span className={styles.rowName}>{invite.name}</span>
          <span className={cx(styles.statusLine, styles.statusMuted, styles.inviteEmail, styles.wideOnly)}>{invite.email}</span>
          <span className={cx(styles.statusLine, styles.statusMuted, styles.wideOnly)}>
            {today ? invitedLabel(localDateOf(invite.sentAt), today) : 'Invited'}
            {expired ? ' · link expired' : null}
          </span>
          <span className={cx(styles.inviteActions, styles.wideOnly)}>
            <button
              type="button"
              className={styles.inlineAction}
              onClick={resend}
              disabled={pending}
              aria-busy={pending || undefined}
              aria-label={pending ? undefined : `Resend invite to ${invite.email}`}
            >
              {resendLabel}
            </button>
            <button type="button" className={styles.inlineAction} aria-label={`Cancel invite to ${invite.email}`} onClick={() => cancelRef.current?.open()}>
              Cancel
            </button>
          </span>
          {message ? <span role="status" className={styles.inlineStatus}><StatusChip view={message} /></span> : null}
        </span>
        {/* Phones: how long ago (or that the link ran out), and Resend / Cancel invite behind ⋯. */}
        <Chip tone="grey" className={cx(styles.phoneOnly, styles.rowChip, styles.chipLine)}>
          {expired ? 'Link expired' : today ? invitedShortLabel(localDateOf(invite.sentAt), today) : 'Invited'}
        </Chip>
        <MoreMenu
          label={`More for ${invite.name}`}
          className={cx(styles.phoneOnly, styles.rowMore)}
          busy={pending}
          items={[
            { label: pending ? 'Sending…' : 'Resend invite', onSelect: resend, disabled: pending },
            { label: 'Cancel invite…', onSelect: () => cancelRef.current?.open(), danger: true },
          ]}
        />
        {/* The confirm step, outside anything hidden on a phone or laptop so it opens on both. */}
        <CancelInviteButton inviteId={invite.id} email={invite.email} handle={cancelRef} trigger={false} />
      </div>
      <span role="cell" className={cx(styles.cell, styles.cellLast, styles.muted)}>
        <CardLabel>Last workout</CardLabel>
        Not joined yet
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellWeek)}>
        <CardLabel>This week</CardLabel>
        <Dash />
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellFour)}>
        <CardLabel>4 weeks</CardLabel>
        <Dash />
      </span>
      <span role="cell" className={cx(styles.cell, styles.cellPlan)}>
        <CardLabel>Plan</CardLabel>
        {plan ? (
          <span className={styles.planStack}>
            <span className={styles.planTitle}>{plan.kind === 'program' ? plan.name : `Single workout: ${plan.name}`}</span>
            <span className={styles.planDetail}>
              {plan.kind === 'program' ? `starts ${formatShortDay(plan.on)}` : formatShortDay(plan.on)}
              {plan.kind === 'single' && plan.more > 0 ? ` · ${plan.more} more` : null}
            </span>
          </span>
        ) : (
          <span className={styles.muted}>Nothing planned</span>
        )}
      </span>
    </div>
  );
}

/**
 * The Clients list: search, filter chips (only those with someone in them), sort, and one row per client and pending
 * invite. Stats use the coach's own today, so they appear right after the page loads in the browser.
 */
export function ClientDirectory({ data, invites, lookbackDays }: { data: HomeData; invites: DirectoryInvite[]; lookbackDays: number }) {
  const today = useBrowserToday();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DirectoryFilter>('active');
  const [sort, setSort] = useState<DirectorySort>('last_workout');
  // A new invite (just sent from the invite window) switches the list to Invited, so the coach sees it there.
  const [knownInvites, setKnownInvites] = useState(invites);
  if (knownInvites !== invites) {
    const known = new Set(knownInvites.map((i) => i.id));
    if (invites.some((i) => !known.has(i.id))) setFilter('invited');
    setKnownInvites(invites);
  }

  const people = useMemo(() => {
    const names = new Map(data.clients.map((c) => [c.id, c.lastWorkoutName]));
    return homeClients(data).map((c) => ({ ...c, lastWorkoutName: names.get(c.id) ?? null }));
  }, [data]);

  const rows = useMemo(() => {
    if (!today) return null;
    return directoryRows({
      clients: people,
      workouts: data.workouts,
      assignments: data.assignments,
      today,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lookbackDays,
    });
  }, [people, data, today, lookbackDays]);
  const rowById = useMemo(() => new Map((rows ?? []).map((r) => [r.clientId, r])), [rows]);

  const counts: Record<DirectoryFilter, number> = useMemo(() => {
    const c = rows ? directoryCounts(rows) : { active: people.length, missed: 0, plan_ending: 0, nothing_planned: 0 };
    return { ...c, active: people.length, invited: invites.length };
  }, [rows, people.length, invites.length]);
  // Only chips with someone in them; "Active" always. The one picked stays even if it empties (so it can be unpicked).
  const chips = FILTERS.filter((f) => f === 'active' || f === filter || counts[f] > 0);
  const total = people.length + invites.length;

  const shownClients = useMemo(() => {
    const nameOf = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();
    const list = people.filter((c) => {
      const row = rowById.get(c.id);
      return filter === 'active' || (row !== undefined && matchesDirectoryFilter(row, filter));
    });
    const cmp = compareDirectoryRows(sort);
    const sorted = list
      .sort((a, b) => {
        const x = rowById.get(a.id);
        const y = rowById.get(b.id);
        return x && y ? cmp(x, y) : compareByLastName(a, b);
      })
      .map((c) => ({ id: c.id, name: nameOf(c), row: rowById.get(c.id) ?? null }));
    // The shared smart search (typos, partial words, any order): best match first, the sort order within a tier.
    return smartFilter(sorted, query, (c) => c.name);
  }, [people, rowById, filter, query, sort]);
  const shownInvites = useMemo(() => (filter === 'invited' ? searchInvites(invites, query) : []), [filter, invites, query]);

  const shownTotal = shownClients.length + shownInvites.length;
  const filtering = query.trim() !== '' || filter !== 'active';

  return (
    <section aria-labelledby="clients-heading" className={styles.directory}>
      <h2 id="clients-heading" tabIndex={-1} className={styles.visuallyHidden}>Client list</h2>
      <div className={styles.toolbar} role="search" aria-label="Find clients">
        <label className={styles.searchField}>
          <span className={styles.visuallyHidden}>Search clients</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${total} ${total === 1 ? 'client' : 'clients'}`}
            className={styles.searchInput}
            autoComplete="off"
          />
        </label>
        <div role="group" aria-label="Filter clients" className={styles.filters}>
          {chips.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              className={cx(styles.filterChip, f === 'missed' && styles.filterAlert)}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]} <span className={styles.filterCount}>{counts[f]}</span>
            </button>
          ))}
        </div>
        {/* Phones: how many show, beside Sort ("41 active"). The status line below says it for screen readers. */}
        <span aria-hidden="true" className={cx(styles.phoneOnly, styles.shownCaption)}>{shownCaption(filter, shownTotal)}</span>
        <label className={styles.sortField}>
          <span>Sort:</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as DirectorySort)} className={styles.sortSelect}>
            {(Object.keys(SORT_LABEL) as DirectorySort[]).map((s) => (
              <option key={s} value={s}>{SORT_LABEL[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {/* Always rendered (never display: none), so screen readers announce each change. */}
      <p role="status" className={styles.visuallyHidden}>
        {filtering ? `Showing ${shownTotal} of ${counts.active} active` : `Showing all ${counts.active} active`}
      </p>

      <div className={styles.tableWrap}>
        <div role="table" aria-label="Clients" className={styles.table}>
          <div role="rowgroup" className={styles.tableHead}>
            <div role="row" className={styles.row}>
              <span role="columnheader">Client</span>
              <span role="columnheader">Last workout</span>
              <span role="columnheader">This week</span>
              <span role="columnheader">4 weeks</span>
              <span role="columnheader">Plan</span>
            </div>
          </div>
          <div role="rowgroup">
            {shownTotal === 0 ? (
              <div role="row" className={styles.emptyRow}>
                <span role="cell">
                  {total === 0
                    ? 'No clients yet. Invite your first client.'
                    : filter === 'invited' && query.trim() === ''
                      ? 'No invites waiting.'
                      : 'No clients match.'}
                </span>
              </div>
            ) : null}
            {shownClients.map((c) => (
              <ClientRow key={c.id} id={c.id} name={c.name} row={c.row} today={today} lookbackDays={lookbackDays} />
            ))}
            {shownInvites.map((i) => (
              <InviteRow key={i.id} invite={i} today={today} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
