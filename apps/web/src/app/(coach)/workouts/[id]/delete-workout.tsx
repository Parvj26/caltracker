'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { countProgramUses, deleteWorkout } from '../actions';
import styles from '../workouts.module.css';

/** Delete a library workout, after saying how many programs use it (Review Focus 5). */
export function DeleteWorkout({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [uses, setUses] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setError(null);
    setUses(null);
    dialogRef.current?.showModal();
    countProgramUses(id)
      .then(setUses)
      .catch(() => setError("Couldn't check which programs use it. Please try again."));
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const outcome = await deleteWorkout(id);
      if (outcome.ok) {
        dialogRef.current?.close();
        router.push('/workouts');
      } else setError(outcome.error ?? "Couldn't delete. Please try again.");
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={open}>
        Delete workout
      </Button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <h2 id={titleId} className={styles.dialogTitle}>Delete {name}?</h2>
        <p id={bodyId} className={styles.dialogBody} aria-live="polite">
          {uses === null
            ? 'Checking which programs use it…'
            : `Used in ${uses} ${uses === 1 ? 'program' : 'programs'}. Deleting removes it from them. Clients' calendars keep their copies${
                uses > 0 ? ', except upcoming ones not yet started from programs with Live Sync on' : ''
              }.`}
        </p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} pending={pending} disabled={uses === null}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </dialog>
    </>
  );
}
