'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  checkClients,
  compareByLastName,
  compareClientChecks,
  foldForSearch,
  lastWorkoutLabel,
  type ClientCheck,
  type ClientSort,
  type ClientStatus,
  type IsoDate,
} from '@caltracker/shared';
import { Card, Chip, SelectField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { checkInput, homeClients, reasonText, STATUS_LABEL, STATUS_TONE } from '@/lib/daily-check';
import { useBrowserToday } from '@/lib/local-today';
import { avatarTone, initials } from './avatar';
import { ResendButton } from './resend-button';
import { CancelInviteButton, RemoveClientButton } from './row-actions';
import styles from './clients.module.css';

export type DirectoryPerson = { id: string; name: string; email: string };
export type DirectoryInvite = { id: string; name: string; email: string; firstName: string; lastName: string; sent: string; expiry: string };

type Filter = 'all' | ClientStatus | 'invited';
const FILTERS: readonly Filter[] = ['all', 'needs_attention', 'program_ending', 'nothing_planned', 'on_track', 'invited'];
const SORT_LABEL: Record<ClientSort, string> = { name: 'Name', last_workout: 'Last workout', end_date: 'Program end date' };

const endFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = (d: IsoDate) => endFormat.format(new Date(`${d}T00:00:00Z`));

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" data-avatar="" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

const matches = (query: string, ...fields: string[]) => {
  const q = foldForSearch(query.trim());
  return q === '' || fields.some((f) => foldForSearch(f).includes(q));
};

/**
 * The Clients list: search, status filter and sort over current clients and pending invites. Status and the dated
 * columns use the coach's own today, so they appear right after the page loads in the browser.
 */
export function ClientDirectory({
  data,
  people,
  invites,
  lookbackDays,
}: {
  data: HomeData;
  people: DirectoryPerson[];
  invites: DirectoryInvite[];
  lookbackDays: number;
}) {
  const today = useBrowserToday();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ClientSort>('name');

  const rows = useMemo(() => {
    const personById = new Map(people.map((p) => [p.id, p]));
    const input = today ? checkInput(data, today, Intl.DateTimeFormat().resolvedOptions().timeZone, lookbackDays) : null;
    const checks = new Map<string, ClientCheck>((input ? checkClients(input) : []).map((c) => [c.clientId, c]));
    return (input?.clients ?? homeClients(data)).map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      joinedOn: c.joinedOn,
      name: personById.get(c.id)?.name ?? `${c.firstName} ${c.lastName}`.trim(),
      email: personById.get(c.id)?.email ?? '',
      check: checks.get(c.id) ?? null,
    }));
  }, [data, people, today, lookbackDays]);

  const counts = useMemo(() => {
    const out: Record<Filter, number> = { all: rows.length + invites.length, needs_attention: 0, program_ending: 0, nothing_planned: 0, on_track: 0, invited: invites.length };
    for (const r of rows) if (r.check) out[r.check.status] += 1;
    return out;
  }, [rows, invites.length]);

  const shownClients = useMemo(() => {
    const list = rows.filter((r) => (filter === 'all' || r.check?.status === filter) && matches(query, r.name, r.email));
    const cmp = compareClientChecks(sort);
    return list.sort((a, b) => (a.check && b.check ? cmp({ ...a, check: a.check }, { ...b, check: b.check }) : compareByLastName(a, b)));
  }, [rows, filter, query, sort]);
  const shownInvites = invites.filter((i) => matches(query, i.name, i.email));

  const showClients = filter !== 'invited';
  const showInvites = filter === 'all' || filter === 'invited';
  const filtering = query.trim() !== '' || filter !== 'all';
  const shownTotal = (showClients ? shownClients.length : 0) + (showInvites ? shownInvites.length : 0);

  return (
    <>
      <div className={styles.toolbar} role="search" aria-label="Find clients">
        <label className={styles.searchField}>
          <span className={styles.visuallyHidden}>Search clients</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className={styles.searchInput}
            autoComplete="off"
          />
        </label>
        <SelectField label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as ClientSort)} className={styles.sortField}>
          {(Object.keys(SORT_LABEL) as ClientSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </SelectField>
        <div role="group" aria-label="Filter by status" className={styles.filters}>
          {FILTERS.map((f) => {
            const label = f === 'all' ? 'All' : STATUS_LABEL[f];
            const known = today !== null || f === 'all' || f === 'invited';
            return (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                className={styles.filterChip}
                // aria-disabled, not disabled: the chip stays focusable and announced while the statuses load.
                aria-disabled={!known || undefined}
                onClick={() => {
                  if (known) setFilter(f);
                }}
              >
                {label}{' '}
                {known ? <span className={styles.filterCount}>{counts[f]}</span> : null}
              </button>
            );
          })}
        </div>
        {/* Always rendered (never display: none), so screen readers announce each change. */}
        <p role="status" className={styles.filterResult}>
          {filtering ? `Showing ${shownTotal} of ${counts.all}` : `Showing all ${counts.all}`}
        </p>
      </div>

      {showClients ? (
        <Card className={styles.listCard}>
          <section aria-labelledby="clients-heading">
            <h2 id="clients-heading" tabIndex={-1} className={styles.sectionHeading}>Clients</h2>
            <div role="table" aria-label="Clients" className={cx(styles.rows, styles.clientRows)}>
              <div role="rowgroup" className={styles.headRow}>
                <div role="row" className={styles.row}>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Last workout</span>
                  <span role="columnheader">This week</span>
                  <span role="columnheader">Program</span>
                  <span role="columnheader"><span className={styles.visuallyHidden}>Actions</span></span>
                </div>
              </div>
              <div role="rowgroup">
                {shownClients.length === 0 ? (
                  <div role="row" className={styles.emptyRow}>
                    <span role="cell">{rows.length === 0 ? 'No clients yet. Add one above.' : 'No clients match.'}</span>
                  </div>
                ) : (
                  shownClients.map((r) => {
                    const c = r.check;
                    const why = c && today ? c.reasons.filter((x) => x.kind !== 'new_bests').map((x) => reasonText(x, today)) : [];
                    return (
                      <div role="row" key={r.id} className={styles.row} data-client-id={r.id}>
                        <div role="cell" className={styles.nameCell}>
                          <Avatar name={r.name} toneKey={r.id} />
                          <span className={styles.nameStack}>
                            <Link href={`/clients/${r.id}`} className={cx(styles.name, styles.nameLink)}>{r.name || 'Client'}</Link>
                            {r.email ? <span className={styles.email}>{r.email}</span> : null}
                          </span>
                        </div>
                        <span role="cell" className={styles.statusCell}>
                          {c ? <Chip tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Chip> : null}
                          {why.map((w) => <span key={w} className={styles.why}>{w}</span>)}
                        </span>
                        <span role="cell" className={styles.meta}>
                          <span aria-hidden="true" className={styles.narrowOnly}>Last workout: </span>
                          {c && today ? lastWorkoutLabel(c.lastWorkoutOn, today, r.joinedOn, lookbackDays) : ''}
                        </span>
                        <span role="cell" className={styles.meta}>
                          <span aria-hidden="true" className={styles.narrowOnly}>This week: </span>
                          {c ? (
                            <>
                              <span aria-hidden="true">{c.week.done} / {c.week.planned}</span>
                              <span className={styles.visuallyHidden}>{`${c.week.done} of ${c.week.planned} done this week`}</span>
                            </>
                          ) : null}
                        </span>
                        <span role="cell" className={styles.programCell}>
                          {c?.program ? (
                            <>
                              <span className={styles.programName} title={c.program.name}>{c.program.name}</span>
                              <span className={styles.programEnd}>ends {shortDate(c.program.endDate)}</span>
                            </>
                          ) : c ? (
                            <span className={styles.programEnd}>No program</span>
                          ) : null}
                        </span>
                        <div role="cell" className={styles.actions}>
                          <RemoveClientButton userId={r.id} name={r.name} />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </Card>
      ) : null}

      {showInvites ? (
        <Card className={styles.listCard}>
          <section aria-labelledby="pending-heading">
            <h2 id="pending-heading" tabIndex={-1} className={styles.sectionHeading}>Pending invites</h2>
            <div role="table" aria-label="Pending invites" className={cx(styles.rows, styles.inviteRows)}>
              <div role="rowgroup" className={styles.headRow}>
                <div role="row" className={styles.row}>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Email</span>
                  <span role="columnheader">Sent</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader"><span className={styles.visuallyHidden}>Actions</span></span>
                </div>
              </div>
              <div role="rowgroup">
                {shownInvites.length === 0 ? (
                  <div role="row" className={styles.emptyRow}>
                    <span role="cell">{invites.length === 0 ? 'No pending invites.' : 'No invites match.'}</span>
                  </div>
                ) : (
                  shownInvites.map((i) => (
                    <div role="row" key={i.id} className={styles.row}>
                      <div role="cell" className={styles.nameCell}>
                        <Avatar name={i.name} toneKey={i.email} />
                        <span className={styles.name}>{i.name}</span>
                      </div>
                      <span role="cell" className={styles.email}>{i.email}</span>
                      <span role="cell" className={styles.meta}>
                        <span aria-hidden="true" className={styles.narrowOnly}>Sent </span>
                        {i.sent}
                      </span>
                      <span role="cell" className={styles.expires}>
                        <Chip tone={STATUS_TONE.invited}>{STATUS_LABEL.invited}</Chip>
                        <Chip tone={i.expiry === 'Expired' ? 'amber' : 'grey'}>{i.expiry}</Chip>
                      </span>
                      <div role="cell" className={styles.actions}>
                        <ResendButton email={i.email} firstName={i.firstName} lastName={i.lastName} />
                        <CancelInviteButton inviteId={i.id} email={i.email} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </Card>
      ) : null}
    </>
  );
}
