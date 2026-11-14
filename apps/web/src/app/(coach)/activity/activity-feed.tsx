'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { formatTimeOfDay, groupByLocalDay } from '@caltracker/shared';
import { CoachAvatar } from '@/components/coach-avatar';
import { Chip } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import styles from './activity.module.css';

export type FeedRow = {
  id: string;
  href: string;
  clientId: string;
  clientName: string;
  workoutName: string;
  finishedAt: string;
  /** "52 min · 18 sets · 4,320 kg lifted", without the time (shown in the viewer's zone). */
  facts: string;
  hasPr: boolean;
  autoFinished: boolean;
  byCoach: boolean;
  planned: boolean;
  reviewed: boolean;
  comments: number;
};

const subscribe = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => 'UTC';

/**
 * The finished workouts under one heading per day (Today, Yesterday, Mon 9 Nov) in the viewer's own time zone. As
 * with LocalDateTime, the server (UTC) renders a first guess and the browser regroups right after hydration; the
 * labels come from our own words (never Intl names), so both renders match. `now` is the server's render time, so
 * "Today" is the same day in both.
 */
export function ActivityFeed({ rows, now }: { rows: FeedRow[]; now: string }) {
  const timeZone = useSyncExternalStore(subscribe, browserZone, serverZone);
  const groups = groupByLocalDay(rows, (r) => r.finishedAt, now, timeZone);
  return (
    <div className={styles.feed}>
      {groups.map((g) => (
        <section key={g.day} className={styles.day} aria-labelledby={`day-${g.day}`}>
          <h2 id={`day-${g.day}`} className={styles.dayHeading}>
            {g.label}
          </h2>
          <ul className={styles.list} aria-label={`Finished workouts, ${g.label}`}>
            {g.items.map((r) => (
              <li key={r.id}>
                <Link href={r.href} className={styles.row}>
                  {r.reviewed ? (
                    <span className={styles.dotOff} aria-hidden="true" />
                  ) : (
                    <span className={styles.dot} role="img" aria-label="Not reviewed" title="No comment from you yet" />
                  )}
                  <CoachAvatar url={null} name={r.clientName} seed={r.clientId} />
                  <span className={styles.rowText}>
                    <span className={styles.client}>{r.clientName}</span>
                    <span className={styles.workoutLine}>
                      <span className={styles.workout}>{r.workoutName}</span>
                      {r.hasPr ? <Chip tone="lime">PR</Chip> : null}
                      {r.autoFinished ? <Chip tone="amber">Auto-finished</Chip> : null}
                      {r.byCoach ? <Chip tone="blue">Logged by coach</Chip> : null}
                      {r.planned ? null : <Chip>Unplanned</Chip>}
                    </span>
                    <span className={styles.facts}>
                      <time dateTime={r.finishedAt}>{formatTimeOfDay(r.finishedAt, timeZone)}</time> · {r.facts}
                    </span>
                  </span>
                  {r.comments > 0 ? (
                    <span className={styles.comments}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="M4 5h16v11H9l-5 4z" />
                      </svg>
                      {r.comments}
                      <span className={styles.srOnly}>{r.comments === 1 ? ' comment' : ' comments'}</span>
                    </span>
                  ) : null}
                  <span className={styles.chevron}>
                    <ChevronIcon direction="right" size={18} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
