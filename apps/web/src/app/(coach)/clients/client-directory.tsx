'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSmartIndex,
  compareByLastName,
  compareDirectoryRows,
  directoryChip,
  directoryCounts,
  directoryRows,
  invitedLabel,
  matchesDirectoryFilter,
  smartFilter,
  smartMatch,
  type DirectoryChip,
  type DirectoryFilter,
  type DirectoryRow,
  type DirectorySort,
  type InvitePlan,
  type IsoDate,
} from '@caltracker/shared';
import { MoreMenu } from '@/components/more-menu';
import { Button, ButtonLink, Chip, ListRow, RowList, SearchBox, SearchEmpty, useSearchQuery, type ChipTone } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { homeClients, localDateOf } from '@/lib/daily-check';
import { useBrowserToday } from '@/lib/local-today';
import { useRememberUrl } from '@/lib/history-back';
import { useUrlChoice } from '@/lib/url-state';
import { useSheetOnLoad } from '@/lib/use-sheet-on-load';
import { avatarTone, initials } from './avatar';
import { INVITE_CLOSED_EVENT } from './invite-dialog';
import { LOW_COMPLETION_PERCENT, lastWorkoutText, planLines, statusText } from './directory-copy';
import type { ConfirmHandle } from './confirm-button';
import { useResendInvite } from './resend-button';
import { CancelInviteButton } from './row-actions';
import { invitePlanText } from './invite-plan-text';
import { InviteSheet, type PlanOptions } from './invite-sheet';
import { searchScope } from './search-scope';
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
  /** The same plan as the invite window's plan step reads it ("Change plan" starts from it). */
  planDetail: InvitePlan;
};

// "Active" (every joined client) is the default; invites wait under their own chip.
/** Invites shown at first, and added by each "Show more". */
const INVITE_PAGE = 50;
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
const SORTS = Object.keys(SORT_LABEL) as DirectorySort[];
const STATUS_CLASS: Record<DirectoryRow['status']['kind'], string | undefined> = {
  training: styles.statusAlert,
  missed: styles.statusAlert,
  plan_ending: styles.statusWarn,
  nothing_planned: styles.statusMuted,
  active: styles.statusGood,
};

/** A row's one status chip (UI rules §7.4): the words carry the meaning, the colour only supports them. */
const CHIP_VIEW: Record<DirectoryChip['kind'], { tone: ChipTone; text: (c: DirectoryChip) => string }> = {
  missed: { tone: 'pink', text: (c) => `Missed ${c.kind === 'missed' ? c.count : 0}` },
  on_track: { tone: 'blue', text: () => 'On track' },
  nothing_planned: { tone: 'grey', text: () => 'Nothing planned' },
};
/** What the caption above the rows says ("9 active", "3 invites waiting"). */
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

const Dash = () => (
  <>
    <span aria-hidden="true">—</span>
    <span className={styles.visuallyHidden}>None</span>
  </>
);

/** The wide list's columns (a table with headers from about 720 px of list width; the meta line says it below that). */
const COLUMNS = ['Client', 'Status', 'Last workout', '4 weeks', 'Plan'];

function ClientRow({ name, row, today, lookbackDays, id }: { id: string; name: string; row: DirectoryRow | null; today: IsoDate | null; lookbackDays: number }) {
  const plan = row && today ? planLines(row.plan, today) : null;
  const pct = row?.fourWeeks.percent ?? null;
  const chip = row && today ? directoryChip(row) : null;
  const last = row && today ? lastWorkoutText(row, today, lookbackDays) : null;
  const router = useRouter();
  const chipEl = chip ? (
    <Chip tone={CHIP_VIEW[chip.kind].tone} className={styles.rowChip}>
      {CHIP_VIEW[chip.kind].text(chip)}
    </Chip>
  ) : null;
  return (
    <ListRow
      href={`/clients/${id}`}
      title={name || 'Client'}
      leading={<Avatar name={name} toneKey={id} />}
      itemProps={{ 'data-client-id': id }}
      className={styles.clientRow}
      meta={
        row && today ? (
          <>
            {chipEl}
            {row.status.kind === 'training' || row.status.kind === 'plan_ending' ? (
              <span className={cx(STATUS_CLASS[row.status.kind])}>{statusText(row.status, today)}</span>
            ) : null}
            {last ? <span>{last}</span> : null}
            {row.week.planned > 0 ? (
              <span className={row.week.missed > 0 ? styles.behind : undefined}>{`${row.week.done} of ${row.week.planned} this week`}</span>
            ) : null}
          </>
        ) : undefined
      }
      cells={[
        <span key="status" className={styles.statusCell}>
          {chipEl}
          {row && today && (row.status.kind === 'training' || row.status.kind === 'plan_ending') ? (
            <span className={cx(styles.statusLine, STATUS_CLASS[row.status.kind])}>{statusText(row.status, today)}</span>
          ) : null}
        </span>,
        // "Last workout" also carries this week's count ("2 of 3 this week"): a column of its own was mostly "—".
        last || (row && row.week.planned > 0) ? (
          <span className={styles.planStack}>
            {last ? <span>{last}</span> : null}
            {row && row.week.planned > 0 ? (
              <span className={row.week.missed > 0 ? styles.behind : undefined}>{`${row.week.done} of ${row.week.planned} this week`}</span>
            ) : null}
          </span>
        ) : null,
        row ? (
          pct === null ? (
            <Dash />
          ) : (
            <span className={styles.completion}>
              <span aria-hidden="true" className={styles.bar}>
                <span className={cx(styles.barFill, pct < LOW_COMPLETION_PERCENT && styles.barLow)} style={{ width: `${pct}%` }} />
              </span>
              <b className={styles.inkText}>{`${pct}%`}</b>
              <span className={styles.visuallyHidden}>{` (${row.fourWeeks.done} of ${row.fourWeeks.due} done)`}</span>
            </span>
          )
        ) : null,
        plan ? (
          <span className={styles.planStack}>
            <span className={cx(styles.planTitle, styles.inkText)}>{plan.title}</span>
            <span className={cx(styles.planDetail, plan.warn && styles.planWarn)}>{plan.detail}</span>
          </span>
        ) : row && today ? (
          'Nothing planned'
        ) : null,
      ]}
      // The same end on every row, so the columns line up: Assign where nothing is planned, else an empty slot.
      action={
        chip?.kind === 'nothing_planned' ? (
          <ButtonLink href={`/clients/${id}/training?add=program`} variant="quiet" size="compact" className={styles.rowAction} aria-label={`Assign a program to ${name}`}>
            Assign
          </ButtonLink>
        ) : (
          <span aria-hidden="true" className={styles.rowActionSlot} />
        )
      }
      // Nothing planned: a single workout is the other way to start, in ⋯ (one visible action per row, UI rules §7.3).
      more={
        chip?.kind === 'nothing_planned' ? (
          <MoreMenu
            label={`More for ${name}`}
            items={[{ label: 'Add a workout', onSelect: () => router.push(`/clients/${id}/training?add=workout`) }]}
          />
        ) : undefined
      }
    />
  );
}

/** An email that wraps before the "@" (a word break there), not in the middle of a word. */
function emailWithBreak(email: string) {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at)}
      <wbr />
      {email.slice(at)}
    </>
  );
}

/**
 * A pending invite: name, email, when it was sent, what it starts with; Resend, and Cancel invite… in ⋯. Tapping the
 * row (not Resend or ⋯, which sit beside it) opens the invite's window.
 */
function InviteRow({ invite, today, onOpen }: { invite: DirectoryInvite; today: IsoDate | null; onOpen: () => void }) {
  const { expired } = invite;
  const { resend, pending, message } = useResendInvite(invite);
  const cancelRef = useRef<ConfirmHandle>(null);
  const planText = invitePlanText(invite.plan);
  return (
    <ListRow
      title={invite.name}
      leading={<Avatar name={invite.name} toneKey={invite.email} />}
      itemProps={{ 'data-invite-id': invite.id }}
      onOpen={onOpen}
      openLabel={`${invite.name || invite.email}, invite${expired ? ', link expired' : ''}`}
      className={styles.inviteRow}
      meta={
        <>
          <span className={styles.inviteEmail}>{emailWithBreak(invite.email)}</span>
          <span>{today ? invitedLabel(localDateOf(invite.sentAt), today) : 'Invited'}</span>
          {expired ? <Chip tone="amber">Link expired</Chip> : null}
          {planText ? <span>{planText}</span> : null}
          {message ? (
            <span role="status" className={styles.inlineStatus}>
              <StatusChip view={message} />
            </span>
          ) : null}
        </>
      }
      action={
        <Button
          variant="quiet"
          size="compact"
          className={styles.rowAction}
          onClick={resend}
          pending={pending}
          aria-label={pending ? undefined : `Resend invite to ${invite.email}`}
        >
          {pending ? 'Sending…' : 'Resend'}
        </Button>
      }
      more={
        <>
          <MoreMenu
            label={`More for ${invite.name}`}
            busy={pending}
            items={[{ label: 'Cancel invite…', onSelect: () => cancelRef.current?.open(), danger: true }]}
          />
          <CancelInviteButton inviteId={invite.id} email={invite.email} handle={cancelRef} />
        </>
      }
    />
  );
}

/**
 * The Clients list: search, filter chips (only those with someone in them), sort, and one row per client and pending
 * invite. Stats use the coach's own today, so they appear right after the page loads in the browser.
 */
export function ClientDirectory({
  data,
  invites,
  lookbackDays,
  initialQuery = '',
  planOptions,
}: {
  data: HomeData;
  invites: DirectoryInvite[];
  lookbackDays: number;
  initialQuery?: string;
  /** Library workouts, programs and picker hints, for a pending invite's "Change plan". */
  planOptions: PlanOptions;
}) {
  const today = useBrowserToday();
  const { query: typed, setQuery, debounced: query } = useSearchQuery({ initial: initialQuery, urlParam: 'q' });
  // Filter and sort are kept in the address (?filter=&sort=), so Back from a client, a reload or a shared link keeps them.
  const [filter, setFilter] = useUrlChoice<DirectoryFilter>('filter', FILTERS, 'active');
  const [sort, setSort] = useUrlChoice<DirectorySort>('sort', SORTS, 'last_workout');
  // So "‹ Clients" can reopen the list as it is now where the browser can't step back to it.
  useRememberUrl();
  // A new invite (just sent from the invite window) switches the list to Invited, so the coach sees it there. While
  // the window is open its step of history is in the address (?sheet=): switch once it has closed, or closing it
  // (one step back) would bring the old filter back.
  const knownInvites = useRef(invites);
  const newInvite = useRef(false);
  useEffect(() => {
    const known = new Set(knownInvites.current.map((i) => i.id));
    knownInvites.current = invites;
    if (!invites.some((i) => !known.has(i.id))) return;
    if (new URLSearchParams(window.location.search).has('sheet')) newInvite.current = true;
    else setFilter('invited');
  }, [invites, setFilter]);
  useEffect(() => {
    const closed = () => {
      if (!newInvite.current) return;
      newInvite.current = false;
      setFilter('invited');
    };
    window.addEventListener(INVITE_CLOSED_EVENT, closed);
    return () => window.removeEventListener(INVITE_CLOSED_EVENT, closed);
  }, [setFilter]);

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

  const scope = searchScope(filter, query);
  const searching = query.trim() !== '';
  const shownClients = useMemo(() => {
    const { clientFilter } = searchScope(filter, query);
    if (clientFilter === null) return [];
    const nameOf = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();
    const list = people.filter((c) => {
      const row = rowById.get(c.id);
      return clientFilter === 'active' || (row !== undefined && matchesDirectoryFilter(row, clientFilter));
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
  const shownInvites = useMemo(() => (scope.invites ? searchInvites(invites, query) : []), [scope.invites, invites, query]);
  // Long invite lists show 50 at a time (UI rules §7.7); a new search or filter starts again at 50.
  const listKey = `${filter}|${query}`;
  const [inviteLimit, setInviteLimit] = useState({ key: listKey, count: INVITE_PAGE });
  if (inviteLimit.key !== listKey) setInviteLimit({ key: listKey, count: INVITE_PAGE });
  const inviteCount = inviteLimit.key === listKey ? inviteLimit.count : INVITE_PAGE;

  // The pending invite open in its window (by id). After its email changes it has a new id; until the list has
  // reloaded with it, the window keeps showing the invite as it last was.
  const [opened, setOpened] = useState<DirectoryInvite | null>(null);
  // A refresh or shared link with ?sheet=invite-<id> opens that invite's window again (UI rules §8.3).
  useSheetOnLoad((id) => {
    const found = id.startsWith('invite-') ? invites.find((i) => `invite-${i.id}` === id) : undefined;
    if (!found) return false;
    setOpened(found);
    return true;
  });
  const openInvite = opened ? (invites.find((i) => i.id === opened.id) ?? opened) : null;
  // "Cancel invite…" from the window: asked once the window has closed (one pop-up at a time).
  // Each ask is its own request (n), so asking again about the same invite after Cancel opens the question again.
  const [cancelling, setCancelling] = useState<{ invite: DirectoryInvite; n: number } | null>(null);
  const cancelRef = useRef<ConfirmHandle>(null);
  useEffect(() => {
    if (cancelling) cancelRef.current?.open();
  }, [cancelling]);

  const shownTotal = shownClients.length + shownInvites.length;
  const filtering = query.trim() !== '' || filter !== 'active';

  return (
    <section aria-labelledby="clients-heading" className={styles.directory}>
      <h2 id="clients-heading" tabIndex={-1} className={styles.visuallyHidden}>Client list</h2>
      <div className={styles.toolbar} role="search" aria-label="Find clients">
        <SearchBox
          label="Search clients"
          placeholder="Search clients"
          value={typed}
          onChange={setQuery}
          className={styles.searchField}
        />
        {/* One row of chips that scrolls sideways when it doesn't fit (never stacked). */}
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
        <div className={styles.listBar}>
          {/* How many show ("9 active"). The status line below says it for screen readers. */}
          <span aria-hidden="true" className={styles.shownCaption}>
            {searching ? `${shownTotal} found` : shownCaption(filter, shownTotal)}
          </span>
          {filter === 'invited' && !searching ? null : (
            <label className={styles.sortField}>
              <span>Sort:</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as DirectorySort)} className={styles.sortSelect}>
                {(Object.keys(SORT_LABEL) as DirectorySort[]).map((s) => (
                  <option key={s} value={s}>{SORT_LABEL[s]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {/* Always rendered (never display: none), so screen readers announce each change. */}
      <p role="status" className={styles.visuallyHidden}>
        {searching
          ? `Showing ${shownTotal} of ${total}`
          : filtering
            ? `Showing ${shownTotal} of ${counts.active} active`
            : `Showing all ${counts.active} active`}
      </p>

      {shownTotal === 0 ? (
        <p className={styles.emptyLine}>
          {total === 0 ? (
            'No clients yet. Invite your first client.'
          ) : searching ? (
            <SearchEmpty things="clients" query={query} onClear={() => setQuery('')} />
          ) : filter === 'invited' ? (
            'No invites waiting.'
          ) : (
            'No clients match.'
          )}
        </p>
      ) : null}
      {shownClients.length > 0 ? (
        <RowList aria-label="Clients" columns={COLUMNS} className={styles.clientList}>
          {shownClients.map((c) => (
            <ClientRow key={c.id} id={c.id} name={c.name} row={c.row} today={today} lookbackDays={lookbackDays} />
          ))}
        </RowList>
      ) : null}
      {shownInvites.length > 0 ? (
        <section aria-labelledby="invites-heading" className={styles.inviteSection}>
          <h3 id="invites-heading" className={cx(styles.subHeading, filter === 'invited' && !searching && styles.visuallyHidden)}>
            {`Invited · ${shownInvites.length}`}
          </h3>
          <RowList aria-label="Invites" className={styles.inviteList}>
            {shownInvites.slice(0, inviteCount).map((i) => (
              <InviteRow key={i.id} invite={i} today={today} onOpen={() => setOpened(i)} />
            ))}
          </RowList>
          {shownInvites.length > inviteCount ? (
            <Button
              variant="quiet"
              size="compact"
              className={styles.showMore}
              onClick={() => setInviteLimit({ key: listKey, count: inviteCount + INVITE_PAGE })}
            >
              {`Show more (${shownInvites.length - inviteCount} left)`}
            </Button>
          ) : null}
        </section>
      ) : null}
      {openInvite ? (
        <InviteSheet
          invite={openInvite}
          today={today}
          planOptions={planOptions}
          onMoved={(id, email) => setOpened({ ...openInvite, id, email, sentAt: new Date().toISOString(), expired: false })}
          onCancelInvite={() => setCancelling((c) => ({ invite: openInvite, n: (c?.n ?? 0) + 1 }))}
          onClose={() => setOpened(null)}
        />
      ) : null}
      {cancelling ? (
        <CancelInviteButton key={cancelling.invite.id} inviteId={cancelling.invite.id} email={cancelling.invite.email} handle={cancelRef} />
      ) : null}
    </section>
  );
}
