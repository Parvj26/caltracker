'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { completedSetCount, openSetCount, type Units, type WorkoutLogDoc } from '@caltracker/shared';
import { LocalDateTime } from '@/app/(coach)/activity/local-date-time';
import { Button, Card, ErrorText } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import { PlannedVsActual } from '../../logs/[logId]/planned-vs-actual';
import { takeOverSession } from './actions';
import styles from './session.module.css';

/** How often the page reads the client's progress again while they log on the phone. */
const REFRESH_MS = 10_000;

/**
 * The client is logging this workout on their phone (single active logger). The coach sees their progress, read
 * again every few seconds, and can take over (the phone then shows "Your coach is logging this session" and stops
 * editing) or just watch.
 */
export function ClientLogging({
  client,
  log,
  units,
  done,
}: {
  client: { id: string; firstName: string };
  log: WorkoutLogDoc;
  units: Units;
  done: number;
}) {
  const router = useRouter();
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Live progress without a host-specific push channel: the server page is read again on a timer. When the client
  // finishes, the page moves on to the finished log by itself.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const total = completedSetCount(log) + openSetCount(log);
  const name = client.firstName || 'Your client';

  function takeOver() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await takeOverSession(log.id);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        router.refresh();
      } catch (e) {
        setError(failureMessage(e, "Couldn't take over. Check your connection and try again."));
      }
    });
  }

  return (
    <>
      <h1 className={styles.title}>{log.name}</h1>
      <Card className={styles.liveCard}>
        <p className={styles.liveHeading} role="status">
          {name} is logging this now on their phone
        </p>
        <p className={styles.caption}>
          {done} of {total} {total === 1 ? 'set' : 'sets'} done · last update <LocalDateTime iso={log.lastActivityAt} />
        </p>
        <p className={styles.caption}>
          Only one of you can log it. Take over to log it here: their phone then shows &ldquo;Your coach is logging this
          session&rdquo; and stops editing.
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
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
      {viewing ? (
        <section aria-label="What they have logged so far" className={styles.viewOnly}>
          <PlannedVsActual log={log} units={units} swappedFrom={{}} />
        </section>
      ) : null}
    </>
  );
}
