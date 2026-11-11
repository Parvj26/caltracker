'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { completedSetCount, openSetCount, type Units, type WorkoutLogDoc } from '@caltracker/shared';
import { LocalDateTime } from '@/app/(coach)/activity/local-date-time';
import { Button, Card, ErrorText } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { PlannedVsActual } from '../../logs/[logId]/planned-vs-actual';
import { takeOverSession } from './actions';
import styles from './session.module.css';

/**
 * Someone else is logging this workout (single active logger): the client on their phone, or another coach. The
 * coach sees the progress live (the page's LiveRefresh re-renders it whenever the log changes, and moves on to the
 * finished log when they finish) and can take over (the phone then shows "Your coach is
 * logging this session" and stops editing) or just watch.
 */
export function ClientLogging({
  holder,
  log,
  units,
  done,
}: {
  /** Who logs it now: the client on their phone, or another coach of the workspace. */
  holder: { kind: 'client' | 'other_coach'; name: string };
  log: WorkoutLogDoc;
  units: Units;
  done: number;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  const total = completedSetCount(log) + openSetCount(log);

  function takeOver() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await takeOverSession(log.id);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(failureCode(e, 'session_takeover_failed'));
      }
    });
  }

  return (
    <>
      <h1 className={styles.title}>{log.name}</h1>
      <Card className={styles.liveCard}>
        <p className={styles.liveHeading} role="status">
          {holder.kind === 'client' ? `${holder.name} is logging this now on their phone` : `${holder.name} (coach) is logging this session`}
        </p>
        <p className={styles.caption}>
          {done} of {total} {total === 1 ? 'set' : 'sets'} done · last update <LocalDateTime iso={log.lastActivityAt} />
        </p>
        <p className={styles.caption}>
          {holder.kind === 'client'
            ? 'Only one of you can log it. Take over to log it here: their phone then shows “Your coach is logging this session” and stops editing.'
            : `Only one person can log it. Take over to log it here instead of ${holder.name}.`}
        </p>
        <div className={styles.actions}>
          <Button onClick={takeOver} pending={pending} className={styles.big}>
            {pending ? 'Taking over…' : 'Take over'}
          </Button>
          <Button variant="secondary" onClick={() => setViewing((v) => !v)} aria-expanded={viewing} className={styles.big}>
            {viewing ? 'Hide' : 'View only'}
          </Button>
          <Button variant="secondary" onClick={() => router.refresh()} className={styles.big}>
            Refresh
          </Button>
        </div>
        {error ? <ErrorText code={error} /> : null}
      </Card>
      {viewing ? (
        <section aria-label="What they have logged so far" className={styles.viewOnly}>
          <PlannedVsActual log={log} units={units} swappedFrom={{}} />
        </section>
      ) : null}
    </>
  );
}
