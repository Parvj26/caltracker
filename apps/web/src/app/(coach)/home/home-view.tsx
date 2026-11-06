'use client';

import Link from 'next/link';
import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  endingPrograms,
  formatLogDuration,
  missedClients,
  quietClients,
  todayRows,
  weekProgress,
  type HomeClient,
  type IsoDate,
  type TodayRow,
} from '@caltracker/shared';
import { ComingSoon } from '@/components/coming-soon';
import { Card, Chip, Tile } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { useBrowserToday } from '@/lib/local-today';
import { ClientSearch } from './client-search';
import { avatarTone, initials } from '../clients/avatar';
import styles from './home.module.css';

const SHOWN = 5;
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The browser's own calendar date of an instant, as YYYY-MM-DD. */
function localDateOf(iso: string): IsoDate {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim() || 'Client';

function Avatar({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span aria-hidden="true" className={cx(styles.avatar, styles[`avatar-${avatarTone(toneKey)}`])}>
      {initials(name)}
    </span>
  );
}

function statusChip(row: TodayRow) {
  const s = row.status;
  if (s.kind === 'done') return <Chip tone="lime">Done ✓ · {formatLogDuration(s.durationS)}</Chip>;
  if (s.kind === 'training') return <Chip tone="blue">Training now</Chip>;
  return <Chip tone="grey">Not started</Chip>;
}

function Group<T>({ id, title, items, row }: { id?: string; title: string; items: T[]; row: (item: T) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const headingId = `${id ?? title.replace(/\W+/g, '-')}-heading`;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <section id={id} aria-labelledby={headingId} className={styles.group}>
      <h3 id={headingId} className={styles.groupHeading}>{title}</h3>
      <ul className={styles.list}>{shown.map(row)}</ul>
      {items.length > SHOWN && !all ? (
        <button type="button" className={styles.showAll} onClick={() => setAll(true)}>Show all {items.length}</button>
      ) : null}
    </section>
  );
}

function ClientLink({ client, children }: { client: HomeClient; children?: React.ReactNode }) {
  const name = fullName(client);
  return (
    <Link href={`/clients/${client.id}`} className={styles.rowLink}>
      <Avatar name={name} toneKey={client.id} />
      <span className={styles.rowText} title={name}>{name}</span>
      {children}
    </Link>
  );
}

function Skeleton() {
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-label="Loading">
      <div className={cx(styles.skeleton, styles.skeletonTitle)} />
      <div className={styles.tiles}>
        {[0, 1, 2, 3].map((n) => <div key={n} className={cx(styles.skeleton, styles.skeletonTile)} />)}
      </div>
      <div className={cx(styles.skeleton, styles.skeletonList)} />
    </div>
  );
}

export function HomeView({ coachFirstName, data }: { coachFirstName: string; data: HomeData }) {
  const today = useBrowserToday();
  const greeting = useGreeting();
  const view = useMemo(() => {
    if (!today) return null;
    const clients: HomeClient[] = data.clients.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      joinedOn: localDateOf(c.joinedAt),
      lastFinishedOn: c.lastFinishedAt ? localDateOf(c.lastFinishedAt) : null,
    }));
    // Every count covers current clients only.
    const current = new Set(clients.map((c) => c.id));
    const workouts = data.workouts.filter((w) => current.has(w.clientId));
    const byId = new Map(clients.map((c) => [c.id, c]));
    const missed = missedClients(workouts, today);
    return {
      byId,
      rows: todayRows(workouts, clients, today),
      progress: weekProgress(workouts, today),
      missed,
      quiet: quietClients(clients, today, new Set(missed.map((m) => m.clientId))),
      ending: endingPrograms(data.assignments.filter((a) => current.has(a.clientId)), today),
    };
  }, [data, today]);

  if (!today || !view) return <Skeleton />;
  const { byId, rows, progress, missed, quiet, ending } = view;
  const pct = progress.planned === 0 ? 0 : Math.round((progress.done / progress.planned) * 100);
  const onTrack = missed.length === 0 && quiet.length === 0 && ending.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{greeting}{coachFirstName ? `, ${coachFirstName}` : ''}</h1>
        <p className={styles.caption}>{dayFormat.format(new Date(`${today}T00:00:00Z`))}</p>
        <ClientSearch clients={data.clients} />
      </header>

      <div className={styles.tiles}>
        <Tile
          tone="lime"
          label="Done this week"
          value={
            <>
              <span>{progress.done} / {progress.planned}</span>
              <span
                role="progressbar"
                aria-label="Done this week"
                aria-valuemin={0}
                aria-valuenow={progress.done}
                aria-valuemax={progress.planned}
                className={styles.track}
              >
                <span className={styles.fill} style={{ width: `${pct}%` }} />
              </span>
            </>
          }
        />
        <a href="#today" className={styles.tileLink}><Tile tone="blue" label="Workouts today" value={rows.length} /></a>
        <a href="#missed" className={styles.tileLink}><Tile tone="pink" label="Missed 2+" value={missed.length} /></a>
        <ComingSoon label="New PRs this week" className={styles.soonTile}><span className={styles.soonValue}>—</span></ComingSoon>
      </div>

      <div className={styles.columns}>
        <Card className={styles.main}>
          <section id="today" aria-labelledby="today-heading">
            <h2 id="today-heading" className={styles.sectionHeading}>Today&apos;s clients</h2>
            {rows.length === 0 ? (
              <p className={styles.empty}>
                No workouts planned for today. <Link href="/programs">Plan workouts in Programs</Link>
              </p>
            ) : (
              <ul className={styles.list}>
                {rows.map((r) => {
                  const href = r.status.kind === 'done' ? `/clients/${r.client.id}/logs/${r.status.logId}` : `/clients/${r.client.id}`;
                  const name = fullName(r.client);
                  return (
                    <li key={r.workout.id} className={styles.row}>
                      <Link href={href} className={styles.rowLink}>
                        <Avatar name={name} toneKey={r.client.id} />
                        <span className={styles.rowText} title={`${name} · ${r.workout.name}`}>{name} · {r.workout.name}</span>
                        {statusChip(r)}
                      </Link>
                      {r.status.kind === 'not_started' ? <ComingSoon label="Log session" /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </Card>

        <aside aria-labelledby="attention-heading" className={styles.side}>
          <Card className={styles.sideCard}>
            <h2 id="attention-heading" className={styles.sectionHeading}>Needs attention</h2>
            {onTrack ? <p className={styles.empty}>Everyone&apos;s on track.</p> : null}
            {missed.length > 0 ? (
              <Group
                id="missed"
                title="Missed 2+"
                items={missed}
                row={(m) => {
                  const c = byId.get(m.clientId);
                  return c ? (
                    <li key={m.clientId} className={styles.row}>
                      <ClientLink client={c}><span className={styles.detail}>Missed {m.missed} in the last 7 days</span></ClientLink>
                    </li>
                  ) : null;
                }}
              />
            ) : null}
            {quiet.length > 0 ? (
              <Group
                title="No workout in 5+ days"
                items={quiet}
                row={(q) => {
                  const c = byId.get(q.clientId);
                  return c ? (
                    <li key={q.clientId} className={styles.row}>
                      <ClientLink client={c}><span className={styles.detail}>{q.days} days</span></ClientLink>
                      <ComingSoon label="Message" />
                    </li>
                  ) : null;
                }}
              />
            ) : null}
            {ending.length > 0 ? (
              <Group
                title="Program ending soon"
                items={ending}
                row={(e) => {
                  const c = byId.get(e.clientId);
                  return c ? (
                    <li key={e.assignmentId} className={styles.row}>
                      <ClientLink client={c}>
                        <span className={styles.detail}>{e.daysLeft === 0 ? 'Ends today' : `Ends in ${plural(e.daysLeft, 'day', 'days')}`}</span>
                      </ClientLink>
                      <Link href={`/clients/${c.id}?assign=1`} className={styles.assign} aria-label={`Assign a program to ${fullName(c)}`}>Assign</Link>
                    </li>
                  ) : null;
                }}
              />
            ) : null}
            <ComingSoon label="Body scans 30+ days" className={styles.scans} />
          </Card>
        </aside>
      </div>
    </div>
  );
}
