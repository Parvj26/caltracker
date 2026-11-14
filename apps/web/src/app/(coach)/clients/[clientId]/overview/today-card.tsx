'use client';

import Link from 'next/link';
import { formatPlainDay, formatTimeOfDay, type IsoDate } from '@caltracker/shared';
import { ButtonLink, Chip } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import type { ClientOverview } from '@/lib/client-overview';
import { clientToday, relativeDay } from '@/lib/client-today';
import { useNowMinute } from './use-now';
import styles from '../client-page.module.css';

/**
 * The top of the client Overview: what is happening with this client today. A workout planned today (Log session), the
 * client training right now (Watch live, or Continue for the coach's own session), or nothing today (+ Add workout,
 * which opens the Add workout window on the Training tab). The rules are in lib/client-today.ts, shared with Home.
 */
export function TodayCard({ data, today, coachId }: { data: ClientOverview; today: IsoDate; coachId: string }) {
  const now = useNowMinute();
  // The clock is the browser's: until it is known (server render, hydration) keep the card's place.
  if (!now) return <section aria-label="Today" aria-busy="true" className={cx(styles.today, styles.todayLoading)} />;
  const t = clientToday({ clientId: data.clientId, coachId, today, nowMs: now.getTime(), workouts: data.workouts, live: data.live });
  const dayChip = `Today · ${formatPlainDay(today)}`;

  if (t.kind === 'live') {
    const pct = t.log.total === 0 ? 0 : Math.round((t.log.done / t.log.total) * 100);
    return (
      <section aria-label="Today" className={cx(styles.today, styles.todayLive)} data-today="live">
        <div className={styles.todayTop}>
          <span className={styles.liveLabel}>
            <span className={styles.liveDot} aria-hidden="true" />
            Training now
          </span>
          <span className={styles.liveSince}>
            started {formatTimeOfDay(t.log.startedAt)} · {t.minutes} min
          </span>
        </div>
        <h2 className={styles.todayTitle}>{t.log.name}</h2>
        <div className={styles.liveTrack} aria-hidden="true">
          <span className={styles.liveFill} style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.liveSets}>
          {t.log.done} of {t.log.total} sets done
        </p>
        <ButtonLink href={t.action.href} className={cx(styles.todayAction, styles.todayActionLive)}>
          {t.action.label}
        </ButtonLink>
      </section>
    );
  }

  if (t.kind === 'planned') {
    const extra = data.todayPreviews[t.workout.id];
    const state = t.status.kind === 'done' ? <Chip tone="lime">Done ✓</Chip> : t.status.kind === 'training' ? <Chip tone="lime">● Live</Chip> : null;
    return (
      <section aria-label="Today" className={styles.today} data-today="planned">
        <div className={styles.todayTop}>
          <Chip tone="lime">{dayChip}</Chip>
          {state}
        </div>
        <div>
          <h2 className={styles.todayTitle}>{t.workout.name}</h2>
          {extra?.programName ? <p className={styles.caption}>{extra.programName}</p> : null}
        </div>
        {extra && extra.preview.lines.length > 0 ? (
          <ul className={styles.todayLines}>
            {extra.preview.lines.map((l, i) => (
              <li key={i}>{l.text}</li>
            ))}
            {extra.preview.more > 0 ? <li className={styles.caption}>+{extra.preview.more} more</li> : null}
          </ul>
        ) : null}
        <ButtonLink href={t.action.href} variant={t.action.style === 'filled' ? 'primary' : 'secondary'} className={styles.todayAction}>
          {t.action.label}
        </ButtonLink>
        {t.moreToday > 0 ? (
          <Link href={`/clients/${data.clientId}/training`} className="tap-inline">
            +{t.moreToday} more {t.moreToday === 1 ? 'workout' : 'workouts'} today
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-label="Today" className={styles.today} data-today="nothing">
      <div className={styles.todayTop}>
        <Chip tone="grey">{dayChip}</Chip>
      </div>
      <div>
        <h2 className={styles.todayTitle}>Nothing planned today</h2>
        {t.last ? (
          <p className={styles.caption}>
            Last: {t.last.name} · {relativeDay(t.last.on, today)}
          </p>
        ) : null}
        {t.next ? (
          <p className={styles.caption}>
            Next: {t.next.name} · {relativeDay(t.next.on, today)}
          </p>
        ) : null}
      </div>
      <ButtonLink href={`/clients/${data.clientId}/training?add=workout`} className={styles.todayAction}>
        + Add workout
      </ButtonLink>
    </section>
  );
}
