'use client';

import { useEffect, useId, useRef } from 'react';
import type { WorkoutHints } from '@caltracker/shared';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { Button } from '@/components/ui';
import type { LibraryWorkout } from './program-grid';
import styles from '../programs.module.css';

type Props = {
  /** e.g. "Week 1, Day 4". */
  cellLabel: string;
  library: LibraryWorkout[];
  /** The coach's Recent and Most used workouts, shown first. */
  hints?: WorkoutHints | undefined;
  onPick: (workout: LibraryWorkout) => void;
  onClose: () => void;
  /** On a program the empty library also explains that programs are built from it. */
  forProgram?: boolean;
};

/**
 * Pick a library workout for one day, in a native modal dialog (focus is trapped and Escape closes it). One tap picks
 * it. This is the keyboard and touch path; dragging from the library panel does the same with a mouse.
 */
export function WorkoutPicker({ cellLabel, library, hints, onPick, onClose, forProgram = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    // The picker unmounts when it closes, so hand focus back to the "+" button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Add a workout to {cellLabel}</h2>
      <WorkoutChoices library={library} {...(hints ? { hints } : {})} onPick={onPick} forProgram={forProgram} />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
