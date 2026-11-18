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
      historyId="add-workout"
      title={`Add a workout to ${cellLabel}`}
      titleSafe
      onClose={onClose}
      noKeyboardOnTouch
      fullScreenOnPhone
    >
      <div className={styles.pickerBody}>
        {onNew ? (
          <>
            <button type="button" className={styles.newWorkout} onClick={onNew}>
              <span className={styles.newWorkoutPlus} aria-hidden="true">+</span>
              <span className={styles.newWorkoutText}>
                <span>New workout</span>
                <span className={styles.newWorkoutSub}>Build it here. It’s also saved to Workouts.</span>
              </span>
            </button>
            {library.length > 0 ? <p className={styles.pickLabel}>OR PICK ONE YOU’VE MADE</p> : null}
          </>
        ) : null}
        <WorkoutChoices library={library} {...(hints ? { hints } : {})} onPick={onPick} forProgram={forProgram} />
      </div>
    </AdaptiveDialog>
  );
}
