'use client';

import { useEffect, useState } from 'react';
import { workoutSummaryRows, type Units } from '@caltracker/shared';
import { AdaptiveDialog, Button } from '@/components/ui';
import { loadSlotWorkout, type SlotWorkout } from '../actions';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Tap a workout on the plan: a card with its exercises (one line each), its notes and how many days of the program
 * use it, with Edit workout, Copy to…, Move to… and Remove from day, in the shared AdaptiveDialog (a bottom sheet
 * on a phone). ×, Escape and Back close it.
 */
export function SlotSummary({
  slot,
  units,
  onEdit,
  onMove,
  onCopy,
  onRemove,
  onClose,
}: {
  slot: Slot;
  units: Units;
  onEdit: (workout: SlotWorkout) => void;
  onMove: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [workout, setWorkout] = useState<SlotWorkout | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadSlotWorkout(slot.id)
      .then((w) => {
        if (!live) return;
        if (w) setWorkout(w);
        else setFailed(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [slot.id]);

  const rows = workout ? workoutSummaryRows(workout.doc, units) : [];

  return (
    <AdaptiveDialog
      historyId={`slot-${slot.id}`}
      title={workout?.doc.name ?? slot.workoutName}
      subtitle={
        <>
          <span className={styles.eyebrow}>
            WEEK {slot.week} · DAY {slot.day}
          </span>
          {workout ? (
            <>
              <br />
              {count(rows.length, 'exercise')} · used on {count(workout.daysInProgram, 'day')} in this program
            </>
          ) : null}
        </>
      }
      onClose={onClose}
      noKeyboardOnTouch
      footer={
        <div className={styles.summaryActions}>
          <Button variant="secondary" onClick={onCopy} phSafe>
            Copy to…
          </Button>
          <Button variant="secondary" onClick={onMove} phSafe>
            Move to…
          </Button>
          <Button variant="secondary" className={styles.dangerText} onClick={onRemove} phSafe>
            Remove from day
          </Button>
          <Button disabled={!workout} onClick={() => workout && onEdit(workout)} phSafe>
            Edit workout
          </Button>
        </div>
      }
    >
      {failed ? <p className={styles.dialogBody}>Couldn’t load this workout. Close this and try again.</p> : null}
      {!workout && !failed ? <p className={styles.caption}>Loading…</p> : null}
      {workout?.doc.notes ? <p className={styles.notesBox}>{workout.doc.notes}</p> : null}
      {workout ? (
        <ol className={styles.summaryList} aria-label="Exercises">
          {rows.map((r, i) => (
            <li key={r.key} className={styles.summaryRow}>
              <span className={styles.summaryNumber} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.summaryText}>
                <span className={styles.summaryName}>{r.name}</span>
                <span className={styles.caption}>{r.line}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </AdaptiveDialog>
  );
}
