'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { Button, ErrorText } from '@/components/ui';
import type { SimpleOutcome } from './actions';
import styles from './clients.module.css';

type Props = {
  /** Visible label on the row button, e.g. "Remove". */
  label: string;
  /** Full accessible name, e.g. "Remove Sam Lee", so screen readers know which row. */
  ariaLabel: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<SimpleOutcome>;
};

/** A row button that asks first, in a native modal dialog (focus is trapped and Escape closes it). */
export function ConfirmButton({ label, ariaLabel, title, body, confirmLabel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const outcome = await onConfirm();
      if (outcome.ok) dialogRef.current?.close();
      else setError(outcome.error);
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        className={styles.rowButton}
        aria-label={ariaLabel}
        onClick={() => {
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        {label}
      </Button>
      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-describedby={bodyId}>
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <p id={bodyId} className={styles.dialogBody}>{body}</p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className={styles.dialogActions}>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={confirm} pending={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
