'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  attentionGroups,
  checkClients,
  compareByLastName,
  formatLogDuration,
  formatShortDate,
  isScanDue,
  prsThisWeek,
  todayRows,
  weekProgress,
  type AttentionGroup,
  type AttentionKind,
  type HomeClient,
  type TodayRow,
} from '@caltracker/shared';
import { ComingSoon } from '@/components/coming-soon';
import { Card, Chip, Tile } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { HomeData } from '@/lib/coach-home';
import { checkInput, GROUP_ID, GROUP_TITLE, reasonText } from '@/lib/daily-check';
import { useBrowserToday } from '@/lib/local-today';
import { ClientSearch } from './client-search';
import { avatarTone, initials } from '../clients/avatar';
import styles from './home.module.css';

const SHOWN = 5;
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** The problems a coach acts on; "new bests" is a celebration and never makes Home say someone needs attention. */
const PROBLEMS: ReadonlySet<AttentionKind> = new Set(['missed_in_a_row', 'missed', 'program_ending', 'nothing_planned', 'quiet']);
/** Reasons where the next step is planning: those rows get an Assign action. */
const NEEDS_PLAN: ReadonlySet<AttentionKind> = new Set(['program_ending', 'nothing_planned']);

/**
 * Messages are not on main yet. When the messages route ships, return a client's conversation URL here and every
 * Needs attention row gets a "Message" action beside Open. Until then there is no button at all (never a dead one).
 */
function messageHref(clientId: string): string | null {
  void clientId;
  return null;
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
    <section id={id} tabIndex={id ? -1 : undefined} aria-labelledby={headingId} className={styles.group}>
      <h3 id={headingId} className={styles.groupHeading}>
        {title} <span className={styles.groupCount}>({items.length})</span>
      </h3>
      <ul className={styles.list}>{shown.map(row)}</ul>
      {items.length > SHOWN && !all ? (
        <button type="button" className={styles.showAll} onClick={() => setAll(true)}>Show all {items.length}</button>
      ) : null}
    </section>
  );
}

/** One Needs attention row: who, why, and what to do about it. */
function AttentionRow({ client, why, assign }: { client: HomeClient; why: string; assign: boolean }) {
  const name = fullName(client);
  const message = messageHref(client.id);
  return (
    <li className={cx(styles.row, styles.attentionRow)}>
      <Avatar name={name} toneKey={client.id} />
      <span className={styles.who}>
        <span className={styles.rowText} title={name}>{name}</span>
        <span className={styles.why}>{why}</span>
      </span>
      <span className={styles.rowActions}>
        <Link href={`/clients/${client.id}`} className={styles.assign} aria-label={`Open ${name}`}>Open</Link>
        {assign ? (
          <Link href={`/clients/${client.id}/training?assign=1`} className={styles.assign} aria-label={`Assign a program to ${name}`}>Assign</Link>
        ) : null}
        {message ? <Link href={message} className={styles.assign} aria-label={`Message ${name}`}>Message</Link> : null}
      </span>
    </li>
  );
}

/** A Body scans 30+ days row: who, when they were last scanned, and a shortcut to the scan form. */
function ScanDueRow({ client, why }: { client: HomeClient; why: string }) {
  const name = fullName(client);
  return (
    <li className={cx(styles.row, styles.attentionRow)}>
      <Avatar name={name} toneKey={client.id} />
      <span className={styles.who}>
        <span className={styles.rowText} title={name}>{name}</span>
        <span className={styles.why}>{why}</span>
      </span>
      <span className={styles.rowActions}>
        <Link href={`/clients/${client.id}/body?scan=1`} className={styles.assign} aria-label={`Add a scan for ${name}`}>Add scan</Link>
      </span>
    </li>
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
  const router = useRouter();
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
    const groups = attentionGroups(checkClients(input));
    const missedIds = new Set(groups.filter((g) => g.kind === 'missed' || g.kind === 'missed_in_a_row').flatMap((g) => g.items.map((i) => i.clientId)));
    // Body scans 30+ days: oldest scan (or oldest join, if never scanned) first.
    const lastScanOf = new Map(data.clients.map((c) => [c.id, c.lastScanOn]));
    const scansDue = input.clients
      .filter((c) => isScanDue({ joinedOn: c.joinedOn }, lastScanOf.get(c.id) ?? null, today))
      .map((c) => ({ client: c, lastScanOn: lastScanOf.get(c.id) ?? null }))
      .sort((x, y) => (x.lastScanOn ?? x.client.joinedOn).localeCompare(y.lastScanOn ?? y.client.joinedOn));
    return {
      today,
      scansDue,
      newPrs: prsThisWeek(input.prs, new Set(byId.keys()), today, timeZone),
      byId,
      rows: todayRows(input.workouts, input.clients, today),
      progress: weekProgress(input.workouts, today),
      groups,
      missedCount: missedIds.size,
      firstMissed: groups.find((g) => g.kind === 'missed_in_a_row' || g.kind === 'missed')?.kind ?? null,
    };
  }, [data, today]);

  if (!today || !view) return <Skeleton />;
  const { byId, rows, progress, groups, missedCount, firstMissed, newPrs, scansDue } = view;
  const pct = progress.planned === 0 ? 0 : Math.round((progress.done / progress.planned) * 100);
  const onTrack = !groups.some((g) => PROBLEMS.has(g.kind)) && scansDue.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{greeting}{coachFirstName ? `, ${coachFirstName}` : ''}</h1>
        <p className={styles.caption}>{dayFormat.format(new Date(`${today}T00:00:00Z`))}</p>
        <ClientSearch clients={searchable} />
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
                aria-valuemax={Math.max(progress.planned, 1)}
                aria-valuetext={`${progress.done} of ${progress.planned}`}
                className={styles.track}
              >
                <span className={styles.fill} style={{ width: `${pct}%` }} />
              </span>
            </>
          }
        />
        <a href="#today" className={styles.tileLink}><Tile tone="blue" label="Workouts today" value={rows.length} /></a>
        {firstMissed ? (
          <a href={`#${GROUP_ID[firstMissed]}`} className={styles.tileLink}><Tile tone="pink" label="Missed a workout" value={missedCount} /></a>
        ) : (
          <Tile tone="pink" label="Missed a workout" value={0} />
        )}
        <Link href="/activity" className={styles.tileLink} aria-label={`New PRs this week: ${newPrs}. Open activity`}>
          <Tile tone="lime" label="New PRs this week" value={newPrs} />
        </Link>
      </div>

      <div className={styles.columns}>
        <Card className={styles.main}>
          <section id="today" tabIndex={-1} aria-labelledby="today-heading">
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
            {groups.map((g: AttentionGroup) => (
              <Group
                key={g.kind}
                id={GROUP_ID[g.kind]}
                title={GROUP_TITLE[g.kind]}
                items={g.items}
                row={(item) => {
                  const c = byId.get(item.clientId);
                  return c ? (
                    <AttentionRow key={item.clientId} client={c} why={reasonText(item.reason, view.today)} assign={NEEDS_PLAN.has(g.kind)} />
                  ) : null;
                }}
              />
            ))}
            {scansDue.length > 0 ? (
              <Group
                id="scans-due"
                title="Body scans 30+ days"
                items={scansDue}
                row={(d) => <ScanDueRow key={d.client.id} client={d.client} why={d.lastScanOn ? `Last scan ${formatShortDate(d.lastScanOn, today)}` : 'Never scanned'} />}
              />
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
