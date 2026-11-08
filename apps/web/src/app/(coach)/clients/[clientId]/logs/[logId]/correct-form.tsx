'use client';

import { useEffect, useState, useTransition } from 'react';
import { liveExercises, type Units, type WorkoutLogDoc } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { SaveStatus } from '@/components/save-status';
import { Button, ErrorText } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { correctLog } from './actions';
import { CLIENT_UPDATED_MESSAGE, buildCorrections, logVersion } from './corrections';
import { PlannedVsActual, draftFor, type Drafts } from './planned-vs-actual';
import styles from './log.module.css';
import { useAnalyticsTask } from '@/lib/analytics/use-analytics-task';

const initialDrafts = (log: WorkoutLogDoc, units: Units): Drafts =>
  Object.fromEntries(log.blocks.flatMap((b) => liveExercises(b).flatMap(({ exercise: e }) => e.sets.filter((s) => s.completedAt !== null).map((s) => [s.id, draftFor(s, e.trackingType, units)]))));

/** Planned vs. actual, with a Correct button (only for finished workouts) that turns the Actual cells into boxes. */
export function CorrectForm({
  log,
  units,
  swappedFrom,
  canCorrect,
  startEditing = false,
}: {
  log: WorkoutLogDoc;
  units: Units;
  swappedFrom: Record<string, string>;
  canCorrect: boolean;
  /** Open with the boxes showing ("Edit results" on the calendar, ?edit=1). */
  startEditing?: boolean;
}) {
  const openAtOnce = startEditing && canCorrect;
  const [editing, setEditing] = useState(openAtOnce);
  const completeEdit = useAnalyticsTask('edit_past_workout', editing);
  const [drafts, setDrafts] = useState<Drafts>(() => (openAtOnce ? initialDrafts(log, units) : {}));
  // The boxes' text and the log's version when Correct was clicked. A live update can replace `log` while the coach
  // types; corrections are worked out against these, and saving waits until the coach has seen the newer numbers.
  const [startDrafts, setStartDrafts] = useState<Drafts>(() => (openAtOnce ? initialDrafts(log, units) : {}));
  const [startVersion, setStartVersion] = useState<string | null>(() => (openAtOnce ? logVersion(log) : null));
  // Drop ?edit=1 once it has opened the boxes, so a reload shows the log as it is.
  useEffect(() => {
    if (!startEditing) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('edit')) return;
    url.searchParams.delete('edit');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [startEditing]);
  const clientUpdated = editing && startVersion !== null && startVersion !== logVersion(log);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    const fresh = initialDrafts(log, units);
    setDrafts(fresh);
    setStartDrafts(fresh);
    setStartVersion(logVersion(log));
    setError(null);
    setEditing(true);
  }

  function save() {
    setError(null);
    if (clientUpdated) return;
    const built = buildCorrections(drafts, startDrafts);
    if ('error' in built) {
      setError(built.error);
      return;
    }
    const { sets } = built;
    startTransition(async () => {
      try {
        const outcome = await correctLog({ logId: log.id, sets });
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
      } catch (e) {
        setError(failureMessage(e, "Couldn't save. Check your connection and try again."));
        return;
      }
      completeEdit();
      setSavedAt(Date.now());
      setEditing(false);
    });
  }

  return (
    <section className={styles.section} aria-label="Planned and actual">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionHeading}>Planned vs. actual</h2>
        <div className={styles.sectionActions}>
          <SaveStatus pending={pending} dirty={false} everSaved={savedAt !== null} savedAt={savedAt} />
          {canCorrect && !editing ? (
            <Button variant="secondary" onClick={start}>
              Correct
            </Button>
          ) : null}
        </div>
      </div>
      <PlannedVsActual
        log={log}
        units={units}
        swappedFrom={swappedFrom}
        edit={editing ? { drafts, onChange: (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } })) } : undefined}
      />
      {editing ? (
        <div className={styles.saveBar}>
          {clientUpdated ? (
            <>
              <ErrorText>{CLIENT_UPDATED_MESSAGE}</ErrorText>
              <Button variant="secondary" onClick={start} disabled={pending}>
                Use latest numbers
              </Button>
            </>
          ) : error ? (
            <ErrorText>{error}</ErrorText>
          ) : null}
          {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending} disabled={clientUpdated}>
            {pending ? 'Saving…' : 'Save corrections'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
