'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { Button, ErrorText } from '@/components/ui';
import type { ErrorCode } from '@caltracker/shared';
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
  /** Element to focus after success (the row, and with it this button, disappears). */
  focusAfterId: string;
  /** A small text button (inside a row's status line) instead of a bordered row button. */
  inline?: boolean;
};

/** A row button that asks first, in a native modal dialog (focus is trapped and Escape closes it). */
export function ConfirmButton({ label, ariaLabel, title, body, confirmLabel, onConfirm, focusAfterId, inline = false }: Props) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const outcome = await onConfirm();
      if (outcome.ok) {
        dialogRef.current?.close();
        document.getElementById(focusAfterId)?.focus();
      } else setError(outcome.code);
    });
  }

  const open = () => {
    setError(null);
    dialogRef.current?.showModal();
  };

  return (
    <>
      {inline ? (
        <button type="button" className={styles.inlineAction} aria-label={ariaLabel} onClick={open}>
          {label}
        </button>
      ) : (
        <Button variant="secondary" className={styles.rowButton} aria-label={ariaLabel} onClick={open}>
          {label}
        </Button>
      )}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // Escape must not close it mid-request, or an error would land in a closed dialog.
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        // After a failure the page may be out of date (for example the invite was accepted meanwhile): refresh it
        // once the coach has read the message.
        onClose={() => {
          if (error) router.refresh();
        }}
      >
        <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
        <p id={bodyId} className={styles.dialogBody}>{body}</p>
        {error ? <ErrorText code={error} /> : null}
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
