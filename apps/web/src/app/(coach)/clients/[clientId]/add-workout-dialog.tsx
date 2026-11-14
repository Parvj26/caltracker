'use client';

import { showDialog } from '@/components/calendar/show-dialog';
import { useEffect, useId, useRef, useState } from 'react';
import { IsoDateSchema, scheduleDateError } from '@caltracker/shared';
import type { IsoDate, WorkoutHints } from '@caltracker/shared';
import { DialogHeader } from '@/components/assign/dialog-header';
import { QuickDayPicker } from '@/components/assign/quick-day-picker';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { Button } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import sheet from '@/components/ui/sheet.module.css';
import styles from '@/components/calendar/calendar.module.css';

type LibraryWorkout = { id: string; name: string };

/**
 * "+ Add workout": pick the day first (today by default, from the quick days or "Pick a date…"), then tap a workout
 * and it is added straight away, like a day's "+". The calendar shows it at once and saves it in the background; its
 * toast offers Undo, and a failed save is undone with a message. Each pick gets its own new id (made by the
 * calendar), so it is added once. On a phone it fills the screen, with Cancel stuck to the bottom.
 */
export function AddWorkoutDialog({
  library,
  hints,
  today,
  dayWorkouts,
  onPick,
  onClose,
}: {
  library: LibraryWorkout[];
  hints?: WorkoutHints | undefined;
  /** The coach's own today, from the browser. */
  today: IsoDate;
  /** The client's workouts by day, when known: quick days say "free" or how many. */
  dayWorkouts?: readonly { date: IsoDate }[];
  onPick: (workout: LibraryWorkout, date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [date, setDate] = useState<string>(today);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog) showDialog(dialog, { noKeyboardOnTouch: true });
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const parsed = IsoDateSchema.safeParse(date);
  const dateError = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);

  return (
    <dialog ref={dialogRef} className={cx(styles.dialog, sheet.sheet)} aria-labelledby={titleId} onClose={onClose}>
      <DialogHeader titleId={titleId} title="Add a workout" titleSafe onClose={() => dialogRef.current?.close()} />
      {library.length > 0 ? (
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
      {library.length > 0 ? <p className={styles.caption}>Tap a workout to add it on this day.</p> : null}
      <WorkoutChoices
        library={library}
        {...(hints ? { hints } : {})}
        disabled={dateError !== null}
        listClassName={sheet.grow}
        onPick={(w) => {
          if (parsed.success && !dateError) onPick(w, parsed.data);
        }}
      />
      <div className={cx(styles.dialogActions, sheet.actions)}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
