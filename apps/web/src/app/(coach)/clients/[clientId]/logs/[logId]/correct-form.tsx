'use client';

import { useState, useTransition } from 'react';
import { parseClock, type Units, type WorkoutLogDoc } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { SaveStatus } from '@/components/save-status';
import { Button, ErrorText } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { correctLog, type SetCorrection } from './actions';
import { PlannedVsActual, draftFor, type Drafts } from './planned-vs-actual';
import styles from './log.module.css';

const initialDrafts = (log: WorkoutLogDoc, units: Units): Drafts =>
  Object.fromEntries(log.blocks.flatMap((b) => b.exercises.flatMap((e) => e.sets.map((s) => [s.id, draftFor(s, e.trackingType, units)]))));

/** A typed number, or null for blank, or NaN for text that isn't one. */
const num = (text: string): number | null => (text.trim() === '' ? null : /^\d*\.?\d+$/.test(text.trim()) ? Number(text) : NaN);

/** Planned vs. actual, with a Correct button (only for finished workouts) that turns the Actual cells into boxes. */
export function CorrectForm({
  log,
  units,
  swappedFrom,
  canCorrect,
}: {
  log: WorkoutLogDoc;
  units: Units;
  swappedFrom: Record<string, string>;
  canCorrect: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setDrafts(initialDrafts(log, units));
    setError(null);
    setEditing(true);
  }

  function save() {
    setError(null);
    const before = initialDrafts(log, units);
    const sets: SetCorrection[] = [];
    for (const [id, draft] of Object.entries(drafts)) {
      const set: SetCorrection = { id };
      let changed = false;
      for (const key of ['reps', 'weight', 'time', 'distance'] as const) {
        const text = draft[key];
        if (text === undefined || text.trim() === (before[id]?.[key] ?? '').trim()) continue;
        const value = key === 'time' ? parseClock(text) : num(text);
        if (value === null) continue; // a blanked box keeps the stored value
        if (Number.isNaN(value)) {
          setError('Check the numbers you typed. Time looks like 1:30.');
          return;
        }
        changed = true;
        if (key === 'reps') set.actualReps = value;
        else if (key === 'weight') set.actualWeight = value;
        else if (key === 'time') set.actualDurationS = value;
        else set.actualDistance = value;
      }
      if (changed) sets.push(set);
    }
    if (sets.length === 0) {
      setError('Nothing to change.');
      return;
    }
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
      setSavedAt(Date.now());
      setEditing(false);
    });
  }

  return (
    <section className={styles.section} aria-label="Planned and actual">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionHeading}>Planned vs. actual</h2>
        {canCorrect && !editing ? (
          <Button variant="secondary" onClick={start}>
            Correct
          </Button>
        ) : null}
      </div>
      <PlannedVsActual
        log={log}
        units={units}
        swappedFrom={swappedFrom}
        edit={editing ? { drafts, onChange: (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } })) } : undefined}
      />
      {editing || savedAt !== null ? (
        <div className={styles.saveBar}>
          {error ? <ErrorText>{error}</ErrorText> : null}
          {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
          <SaveStatus pending={pending} dirty={false} everSaved={savedAt !== null} savedAt={savedAt} />
          {editing ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={save} pending={pending}>
                {pending ? 'Saving…' : 'Save corrections'}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
