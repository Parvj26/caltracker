'use client';

import { useEffect, useId, useState } from 'react';
import { liveSyncStatus } from '@caltracker/shared';
import { Card, ErrorText } from '@/components/ui';
import { failureMessage } from '@/lib/action-errors';
import type { LiveSyncState } from '@/lib/live-sync';
import { getLiveSyncStatus, setProgramLiveSync } from '../actions';
import styles from '../programs.module.css';

/**
 * The program's Live Sync switch and its status line ("Live Sync on · 3 clients · last synced 2 min ago · 1 customised
 * workout skipped"). The grid bumps `refreshKey` after each saved change; with Live Sync on, the status is read again
 * so it shows that sync.
 */
export function LiveSyncPanel({
  programId,
  initial,
  refreshKey,
  onChange,
}: {
  programId: string;
  initial: LiveSyncState;
  refreshKey: number;
  /** Told when the switch changes, so the grid can say whether changes reach clients. */
  onChange: (on: boolean) => void;
}) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "2 min ago" is measured in the browser, after hydration, and kept fresh.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const on = state.on;
  useEffect(() => {
    if (refreshKey === 0 || !on) return;
    let current = true;
    getLiveSyncStatus(programId)
      .then((next) => {
        if (current && next) {
          setState(next);
          setNow(new Date());
        }
      })
      // Only the status line is stale; the change itself was saved.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [refreshKey, on, programId]);

  const labelId = useId();
  const helpId = useId();

  async function toggle() {
    const next = !state.on;
    setPending(true);
    setError(null);
    try {
      const outcome = await setProgramLiveSync(programId, next);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setState({ on: outcome.on, clients: outcome.clients, syncedAt: outcome.syncedAt, skipped: outcome.skipped });
      setNow(new Date());
      onChange(outcome.on);
    } catch (e) {
      setError(failureMessage(e, "Couldn't change Live Sync. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className={styles.liveSync}>
      <div className={styles.liveSyncRow}>
        <span id={labelId} className={styles.sectionHeading}>
          Live Sync
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={state.on}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          className={styles.switch}
          disabled={pending}
          onClick={() => void toggle()}
        >
          <span aria-hidden="true">{state.on ? 'On' : 'Off'}</span>
        </button>
      </div>
      <p id={helpId} className={styles.caption}>
        When on, changes to this program update the calendars of clients on it, from today on. Past days, workouts a
        client has started or done, and workouts you edited for one client stay as they are.
      </p>
      <p className={styles.liveSyncStatus} data-testid="live-sync-status">
        {liveSyncStatus(state, now ?? new Date(state.syncedAt ?? 0))}
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
