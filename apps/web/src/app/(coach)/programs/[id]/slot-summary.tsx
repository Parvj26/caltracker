'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { workoutSummaryRows, type Units } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { loadSlotWorkout, type SlotWorkout } from '../actions';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Tap a workout on the plan: a card with its exercises (one line each), its notes and how many days of the program
 * use it, with Edit workout, Copy to…, Move to… and Remove from day. ✕ or Escape closes it.
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [workout, setWorkout] = useState<SlotWorkout | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

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
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.summary}`} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.summaryHead}>
        <div className={styles.sheetHeading}>
          <span className={styles.eyebrow}>
            WEEK {slot.week} · DAY {slot.day}
          </span>
          <h2 id={titleId} className={styles.summaryTitle}>
            {workout?.doc.name ?? slot.workoutName}
          </h2>
          {workout ? (
            <span className={styles.caption}>
              {count(rows.length, 'exercise')} · used on {count(workout.daysInProgram, 'day')} in this program
            </span>
          ) : null}
        </div>
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={() => dialogRef.current?.close()}>
          <span aria-hidden="true">✕</span>
        </button>
      </div>

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

      <div className={styles.summaryActions}>
        <Button disabled={!workout} onClick={() => workout && onEdit(workout)}>
          Edit workout
        </Button>
        <span className={styles.summarySpacer} />
        <Button variant="secondary" onClick={onCopy}>
          Copy to…
        </Button>
        <Button variant="secondary" onClick={onMove}>
          Move to…
        </Button>
        <Button variant="secondary" className={styles.dangerText} onClick={onRemove}>
          Remove from day
        </Button>
      </div>
    </dialog>
  );
}
