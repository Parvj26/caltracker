'use client';

import type { WorkoutHints } from '@caltracker/shared';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { AdaptiveDialog } from '@/components/ui';
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
  /** Shows "+ New workout" first: build a workout for this day in the editor sheet. */
  onNew?: () => void;
};

/**
 * Pick a library workout for one day, in the shared AdaptiveDialog (focus is trapped; ×, Escape and Back close it).
 * One tap picks it. This is the keyboard and touch path; dragging from the library panel does the same with a mouse.
 */
export function WorkoutPicker({ cellLabel, library, hints, onPick, onClose, forProgram = false, onNew }: Props) {
  // A bottom sheet on a phone (full height: the list is long), a centred dialog wider up; Back closes it.
  return (
    <AdaptiveDialog
      // Unique per day ("pick-workout-week-1-day-4"), and apart from the calendar's own "add-workout" pop-up.
      historyId={`pick-workout-${cellLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
      title={`Add a workout to ${cellLabel}`}
      titleSafe
      onClose={onClose}
      noKeyboardOnTouch
      fullScreenOnPhone
    >
      <div className={styles.pickerBody}>
        {onNew ? <NewWorkoutOption onNew={onNew} sub="Build it here. It’s also saved to Workouts." orPick={library.length > 0} /> : null}
        <WorkoutChoices library={library} {...(hints ? { hints } : {})} onPick={onPick} forProgram={forProgram} />
      </div>
    </AdaptiveDialog>
  );
}

/**
 * "+ New workout" at the top of a workout picker (a program day, or a client's "Add a workout"), with "OR PICK ONE
 * YOU'VE MADE" under it when there are workouts to pick.
 */
export function NewWorkoutOption({ onNew, sub, orPick, disabled = false }: { onNew: () => void; sub: string; orPick: boolean; disabled?: boolean }) {
  return (
    <>
      <button type="button" className={styles.newWorkout} onClick={onNew} disabled={disabled}>
        <span className={styles.newWorkoutPlus} aria-hidden="true">+</span>
        <span className={styles.newWorkoutText}>
          <span>New workout</span>
          <span className={styles.newWorkoutSub}>{sub}</span>
        </span>
      </button>
      {orPick ? <p className={styles.pickLabel}>OR PICK ONE YOU’VE MADE</p> : null}
    </>
  );
}
