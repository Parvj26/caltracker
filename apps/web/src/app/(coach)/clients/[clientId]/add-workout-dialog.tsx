'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IsoDateSchema, scheduleDateError } from '@caltracker/shared';
import type { IsoDate, WorkoutHints } from '@caltracker/shared';
import { WorkoutChoices } from '@/components/assign/workout-choices';
import { Button, TextField, errorFromText } from '@/components/ui';
import styles from '@/components/calendar/calendar.module.css';

type LibraryWorkout = { id: string; name: string };

/**
 * "+ Add workout": pick the day first (today by default), then tap a workout and it is added straight away, like a
 * day's "+". The calendar shows it at once and saves it in the background; its toast offers Undo, and a failed save
 * is undone with a message. Each pick gets its own new id (made by the calendar), so it is added once.
 */
export function AddWorkoutDialog({
  library,
  hints,
  today,
  onPick,
  onClose,
}: {
  library: LibraryWorkout[];
  hints?: WorkoutHints | undefined;
  /** The coach's own today, from the browser. */
  today: IsoDate;
  onPick: (workout: LibraryWorkout, date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [date, setDate] = useState<string>(today);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const parsed = IsoDateSchema.safeParse(date);
  const dateError = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Add a workout</h2>
      {library.length > 0 ? (
        <TextField
          label="Date"
          type="date"
          min={today}
          value={date}
          hint="Tap a workout to add it on this day."
          onChange={(e) => setDate(e.target.value)}
          {...(dateError ? { error: errorFromText(dateError, 'assign_date_invalid') } : {})}
        />
      ) : null}
      <WorkoutChoices
        library={library}
        {...(hints ? { hints } : {})}
        disabled={dateError !== null}
        onPick={(w) => {
          if (parsed.success && !dateError) onPick(w, parsed.data);
        }}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
