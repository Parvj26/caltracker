'use client';

import { useRef, useState } from 'react';
import { IsoDateSchema, scheduleDateError } from '@caltracker/shared';
import type { IsoDate, WorkoutHints } from '@caltracker/shared';
import { QuickDayPicker } from '@/components/assign/quick-day-picker';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { AdaptiveDialog, Button, type AdaptiveDialogHandle } from '@/components/ui';
import { NewWorkoutOption } from '../../programs/[id]/workout-picker';
import styles from '@/components/calendar/calendar.module.css';
import page from './client-page.module.css';

type LibraryWorkout = { id: string; name: string };

/**
 * "+ Add workout": pick the day first (and "+ New workout" builds one for that day in the editor sheet) (today by default, from the quick days or "Pick a date…"), then tap a workout
 * and it is added straight away, like a day's "+". The calendar shows it at once and saves it in the background; its
 * toast offers Undo, and a failed save is undone with a message. Each pick gets its own new id (made by the
 * calendar), so it is added once. In the one pop-up (AdaptiveDialog): Cancel stays pinned at the bottom.
 */
export function AddWorkoutDialog({
  library,
  hints,
  today,
  dayWorkouts,
  onPick,
  onNew,
  onClose,
}: {
  library: LibraryWorkout[];
  hints?: WorkoutHints | undefined;
  /** The coach's own today, from the browser. */
  today: IsoDate;
  /** The client's workouts by day, when known: quick days say "free" or how many. */
  dayWorkouts?: readonly { date: IsoDate }[];
  onPick: (workout: LibraryWorkout, date: IsoDate) => void;
  /** "+ New workout": build one for this client on the day picked here (the calendar opens the editor sheet). */
  onNew?: (date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const [date, setDate] = useState<string>(today);
  // One pick per opening: a second tap while it closes adds nothing.
  const picked = useRef(false);

  const parsed = IsoDateSchema.safeParse(date);
  const dateError = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);

  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId="add-workout"
      title="Add a workout"
      titleSafe
      onClose={onClose}
      noKeyboardOnTouch
      fullScreenOnPhone
      footer={
        <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()}>
          Cancel
        </Button>
      }
    >
      {library.length > 0 || onNew ? (
        <QuickDayPicker
          legend="Day"
          today={today}
          value={date}
          onChange={setDate}
          {...(dayWorkouts ? { workoutsOn: (d: IsoDate) => dayWorkouts.filter((w) => w.date === d).length } : {})}
          fieldMin={today}
          error={dateError}
        />
      ) : null}
      {onNew ? (
        <NewWorkoutOption
          sub="Build it here."
          orPick={library.length > 0}
          disabled={dateError !== null}
          onNew={() => {
            if (!parsed.success || dateError || picked.current) return;
            picked.current = true;
            const day = parsed.data;
            // Its step of history goes first, then the calendar opens the editor.
            void dialogRef.current?.close().then(() => onNew(day));
          }}
        />
      ) : null}
      {library.length > 0 ? <p className={styles.caption}>Tap a workout to add it on this day.</p> : null}
      <WorkoutChoices
        library={library}
        {...(hints ? { hints } : {})}
        disabled={dateError !== null}
        listClassName={page.dialogList}
        onPick={(w) => {
          if (!parsed.success || dateError || picked.current) return;
          picked.current = true;
          const day = parsed.data;
          // Its step of history goes first, then the calendar adds the workout.
          void dialogRef.current?.close().then(() => onPick(w, day));
        }}
      />
    </AdaptiveDialog>
  );
}
