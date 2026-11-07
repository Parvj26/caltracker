'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  attentionGroups,
  checkClients,
  compareByLastName,
  formatLogDuration,
  isScanDue,
  prsThisWeek,
  todayRows,
  weekProgress,
  type HomeClient,
} from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { checkInput } from '@/lib/daily-check';
import {
  attentionCounts,
  attentionEntries,
  attentionRows,
  FILTER_LABEL,
  fixFor,
  isUrgent,
  reasonLine,
  type AttentionFilter,
} from '@/lib/home-attention';
import { todayAction, todayMenu, todayPill } from '@/lib/home-actions';
import { minutesSince, trainingNow, type LiveLog } from '@/lib/home-live';
import { useBrowserToday } from '@/lib/local-today';
import { ClientSearch } from './client-search';
import { RowMenu } from './row-menu';
import { avatarTone, initials } from '../clients/avatar';
import styles from './home.module.css';

/** Needs attention shows this many rows first, then "Show all". */
const SHOWN = 6;
const FILTERS: readonly AttentionFilter[] = ['all', 'missed', 'plan', 'scan'];
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, 60_000);
  return () => clearInterval(timer);
};
const greetingNow = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
/** Morning before 12:00, afternoon before 18:00, evening after, by the browser's clock. */
function useGreeting(): string {
  return useSyncExternalStore(subscribeMinute, greetingNow, () => 'Hello');
}
/** The current minute (as ms), refreshed every minute, for "32 min" on the Training now cards. */
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
function useMinute(): number {
  return useSyncExternalStore(subscribeMinute, minuteNow, () => 0);
}

const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim() || 'Client';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

/** One dark card per client training right now; the whole card opens the live view. */
function LiveCard({ log, client, nowMs }: { log: LiveLog; client: HomeClient; nowMs: number }) {
  const name = fullName(client);
  const pct = log.total === 0 ? 0 : Math.round((log.done / log.total) * 100);
  return (
    <li>
      <Link
        href={`/clients/${client.id}/logs/${log.id}`}
        className={styles.liveCard}
        aria-label={`Watch ${name} live: ${log.name}, ${log.done} of ${log.total} sets`}
      >
        <span className={styles.liveWho}>
          <Avatar name={name} toneKey={client.id} />
          <span className={styles.who}>
            <span className={styles.name}>{name}</span>
            <span className={styles.liveSub}>{log.name} · {minutesSince(log.startedAt, nowMs)} min</span>
          </span>
        </span>
        <span className={styles.liveTrack} aria-hidden="true">
          <span className={styles.liveFill} style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.liveFoot}>{log.done} of {log.total} sets · Watch live →</span>
      </Link>
    </li>
  );
}

function Skeleton() {
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-label="Loading">
      <div className={cx(styles.skeleton, styles.skeletonTitle)} />
      <div className={styles.columns}>
        <div className={cx(styles.skeleton, styles.skeletonList)} />
        <div className={cx(styles.skeleton, styles.skeletonList)} />
      </div>
    </div>
  );
}

export function HomeView({ coachFirstName, coachId, data, live }: { coachFirstName: string; coachId: string; data: HomeData; live: LiveLog[] }) {
  const today = useBrowserToday();
  const greeting = useGreeting();
  const nowMs = useMinute();
  const router = useRouter();
  const [filter, setFilter] = useState<AttentionFilter>('all');
  const [showAll, setShowAll] = useState(false);
  // The server data is from page load: when the browser's day changes, load it again.
  const lastToday = useRef(today);
  useEffect(() => {
    if (today && lastToday.current && today !== lastToday.current) router.refresh();
    if (today) lastToday.current = today;
  }, [today, router]);
  const searchable = useMemo(() => [...data.clients].sort(compareByLastName), [data.clients]);
  const view = useMemo(() => {
    if (!today) return null;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Every count covers current clients only.
    const input = checkInput(data, today, timeZone);
    const byId = new Map(input.clients.map((c) => [c.id, c]));
    // Body scans 30+ days: oldest scan (or oldest join, if never scanned) first.
    const lastScanOf = new Map(data.clients.map((c) => [c.id, c.lastScanOn]));
    const scansDue = input.clients
      .filter((c) => isScanDue({ joinedOn: c.joinedOn }, lastScanOf.get(c.id) ?? null, today))
      .map((c) => ({ clientId: c.id, lastScanOn: lastScanOf.get(c.id) ?? null, from: lastScanOf.get(c.id) ?? c.joinedOn }))
      .sort((x, y) => x.from.localeCompare(y.from));
    return {
      today,
      byId,
      newPrs: prsThisWeek(input.prs, new Set(byId.keys()), today, timeZone),
      rows: todayRows(input.workouts, input.clients, today),
      progress: weekProgress(input.workouts, today),
      groups: attentionGroups(checkClients(input)),
      scansDue,
    };
  }, [data, today]);

  if (!today || !view) return <Skeleton />;
  const { byId, rows, progress, newPrs, groups, scansDue } = view;
  const cards = trainingNow(live, new Set(byId.keys()), nowMs);
  const entries = attentionEntries(groups, scansDue, new Set(cards.map((c) => c.clientId)));
  const counts = attentionCounts(entries);
  // A chip whose count drops to 0 (after a live refresh) disappears: fall back to All.
  const active: AttentionFilter = counts[filter] > 0 ? filter : 'all';
  const attention = attentionRows(entries, active);
  const shown = showAll ? attention : attention.slice(0, SHOWN);
  const todayClients = new Set(rows.map((r) => r.client.id)).size;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headText}>
          <p className={styles.date}>{dayFormat.format(new Date(`${today}T00:00:00Z`))}</p>
          <h1 className={styles.title}>{greeting}{coachFirstName ? `, ${coachFirstName}` : ''}</h1>
          <p className={styles.stats}>
            This week: <b>{progress.done} of {progress.planned}</b> workouts done · <b>{newPrs}</b> new {newPrs === 1 ? 'PR' : 'PRs'} ·{' '}
            <b>{byId.size}</b> {byId.size === 1 ? 'client' : 'clients'}
          </p>
        </div>
        <ClientSearch clients={searchable} />
      </header>

      {cards.length > 0 ? (
        <section aria-labelledby="training-now-heading" className={styles.section}>
          <h2 id="training-now-heading" className={styles.sectionHeading}>
            <span className={styles.liveDot} aria-hidden="true" />
            Training now
          </h2>
          <ul className={styles.liveGrid}>
            {cards.map((l) => <LiveCard key={l.id} log={l} client={byId.get(l.clientId)!} nowMs={nowMs} />)}
          </ul>
        </section>
      ) : null}

      <div className={styles.columns}>
        <section id="today" tabIndex={-1} aria-labelledby="today-heading" className={styles.section}>
          <h2 id="today-heading" className={styles.sectionHeading}>
            Today <span className={styles.count}>{plural(todayClients, 'client', 'clients')}</span>
          </h2>
          {rows.length === 0 ? (
            <p className={styles.empty}>
              No workouts planned for today. <Link href="/programs">Plan workouts in Programs</Link>
            </p>
          ) : (
            <>
              <ul className={styles.todayList}>
                {rows.map((r) => {
                  const name = fullName(r.client);
                  const action = todayAction(r, coachId);
                  const pill = todayPill(r, coachId);
                  const sub = r.status.kind === 'done' ? `${r.workout.name} · ${formatLogDuration(r.status.durationS)}` : r.workout.name;
                  return (
                    <li key={r.workout.id} className={styles.todayRow} data-today-row="">
                      <Avatar name={name} toneKey={r.client.id} />
                      <span className={styles.who}>
                        <span className={styles.name} title={name}>{name}</span>
                        <span className={styles.sub} title={sub}>{sub}</span>
                      </span>
                      <span className={cx(styles.pill, styles[`pill-${pill.tone}`])}>{pill.label}</span>
                      <Link
                        href={action.href}
                        className={cx(styles.action, styles[`action-${action.style}`])}
                        aria-label={`${action.label}: ${name}, ${r.workout.name}`}
                        data-primary=""
                      >
                        {action.label}
                      </Link>
                      <RowMenu name={name} items={todayMenu(r.client.id)} />
                    </li>
                  );
                })}
              </ul>
              <p className={styles.hint}>⋯ has Message, Assign and Open client.</p>
            </>
          )}
        </section>

        <section aria-label="Needs attention" className={styles.section}>
          <h2 id="attention-heading" className={styles.sectionHeading}>
            Needs attention {counts.all > 0 ? <span className={styles.count}>{counts.all}</span> : null}
          </h2>
          {entries.length === 0 ? (
            <p className={styles.empty}>Everyone&apos;s on track.</p>
          ) : (
            <>
              <div className={styles.filters} role="group" aria-label="Filter Needs attention">
                {FILTERS.filter((f) => counts[f] > 0).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={active === f}
                    className={styles.filter}
                    onClick={() => {
                      setFilter(f);
                      setShowAll(false);
                    }}
                  >
                    <span className={styles.filterPill}>{FILTER_LABEL[f]} {counts[f]}</span>
                  </button>
                ))}
              </div>
              <ul className={styles.attentionList}>
                {shown.map(({ clientId, reason, more }) => {
                  const c = byId.get(clientId);
                  if (!c) return null;
                  const name = fullName(c);
                  const fix = fixFor(reason, clientId, name);
                  return (
                    <li key={clientId} className={styles.attentionRow}>
                      <span className={styles.who}>
                        <span className={styles.name} title={name}>{name}</span>
                        <span className={cx(styles.reason, isUrgent(reason) && styles.reasonUrgent)}>
                          {reasonLine(reason, today)}
                          {more > 0 ? <span className={styles.more}> +{more} more</span> : null}
                        </span>
                      </span>
                      <Link href={fix.href} className={cx(styles.action, styles['action-white'])} aria-label={fix.ariaLabel}>
                        {fix.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {attention.length > SHOWN && !showAll ? (
                <button type="button" className={styles.showAll} onClick={() => setShowAll(true)}>
                  Show all {attention.length}
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
