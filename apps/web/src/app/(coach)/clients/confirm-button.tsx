'use client';

import { useRouter } from 'next/navigation';
import { useId, useImperativeHandle, useRef, useState, useTransition, type Ref, type RefObject } from 'react';
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
  /** Opens the dialog from elsewhere (a row's ⋯ menu). */
  handle?: Ref<ConfirmHandle> | undefined;
  /** False: only the dialog, opened through `handle` (the caller draws its own buttons). */
  trigger?: boolean;
};

export type ConfirmHandle = { open: () => void };

type DialogProps = Pick<Props, 'title' | 'body' | 'confirmLabel' | 'onConfirm' | 'focusAfterId'> & {
  dialogRef: RefObject<HTMLDialogElement | null>;
  /** Clears an earlier error; the opener calls it before showModal(). */
  resetRef?: RefObject<(() => void) | null>;
};

/**
 * The asking part on its own: a native modal dialog (focus is trapped and Escape closes it) that the caller opens with
 * `dialogRef.current.showModal()`. ConfirmButton uses it, and so does the client page's "⋯ > Remove client".
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, focusAfterId, dialogRef, resetRef }: DialogProps) {
  const router = useRouter();
  const titleId = useId();
  const bodyId = useId();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  useImperativeHandle(resetRef, () => () => setError(null), []);

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

  return (
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
        if (!error) return;
        router.refresh();
        // Clear it too, so reopening the dialog (from the client header's ⋯) doesn't show the old failure.
        setError(null);
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
  );
}

/** A row button that asks first, in a native modal dialog (focus is trapped and Escape closes it). */
export function ConfirmButton({ label, ariaLabel, title, body, confirmLabel, onConfirm, focusAfterId, inline = false, handle, trigger = true }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resetRef = useRef<(() => void) | null>(null);

  const open = () => {
    resetRef.current?.();
    dialogRef.current?.showModal();
  };
  useImperativeHandle(handle, () => ({ open }));

  return (
    <>
      {!trigger ? null : inline ? (
        <button type="button" className={styles.inlineAction} aria-label={ariaLabel} onClick={open}>
          {label}
        </button>
      ) : (
        <Button variant="secondary" className={styles.rowButton} aria-label={ariaLabel} onClick={open}>
          {label}
        </Button>
      )}
      <ConfirmDialog
        title={title}
        body={body}
        confirmLabel={confirmLabel}
        onConfirm={onConfirm}
        focusAfterId={focusAfterId}
        dialogRef={dialogRef}
        resetRef={resetRef}
      />
    </>
  );
}
