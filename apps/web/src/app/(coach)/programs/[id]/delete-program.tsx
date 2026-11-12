'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useRouter } from 'next/navigation';
import { useId, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { deleteProgram } from '../actions';
import styles from '../programs.module.css';
import { markUndone } from '@/lib/analytics/client';

export type DeleteProgramHandle = { open: () => void };

/**
 * Delete a program, after saying that clients already on it keep their calendars. The program page's ⋯ menu opens it
 * through `handle`.
 */
export function DeleteProgram({ id, name, handle }: { id: string; name: string; handle: Ref<DeleteProgramHandle> }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const outcome = await deleteProgram(id);
      if (outcome.ok) {
        markUndone('program', id);
        dialogRef.current?.close();
        router.push('/programs');
      } else setError(outcome.code);
    });
  }

  useImperativeHandle(handle, () => ({
    open: () => {
      setError(null);
      dialogRef.current?.showModal();
    },
  }));

  return (
    <>
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
        <p id={bodyId} className={styles.dialogBody}>
          The program and its weekly plan are deleted. Clients already on it keep the workouts on their calendars.
        </p>
        {error ? <ErrorText code={error} /> : null}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} pending={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </dialog>
    </>
  );
}
