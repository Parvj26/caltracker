'use client';

import { useRouter } from 'next/navigation';
import { useId, useImperativeHandle, useRef, useState, useTransition, type Ref } from 'react';
import { AdaptiveDialog, Button, ErrorText, type AdaptiveDialogHandle } from '@/components/ui';
import type { ErrorCode } from '@caltracker/shared';
import type { SimpleOutcome } from './actions';
import styles from './clients.module.css';

type Props = {
  /** Visible label on the trigger button, e.g. "Remove client…". */
  label: string;
  /** Full accessible name, starting with the visible label, e.g. "Remove client… Sam Lee". */
  ariaLabel: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<SimpleOutcome>;
  /** Element to focus after success (the row, and with it this button, disappears). */
  focusAfterId: string;
  /** Names this pop-up in the address while it is open (?sheet=…), so Back closes it. Unique per item. */
  historyId: string;
  /** Opens the dialog from elsewhere (a row's ⋯ menu). */
  handle?: Ref<ConfirmHandle> | undefined;
  /** False: only the dialog, opened through `handle` (the caller draws its own buttons). */
  trigger?: boolean;
};

export type ConfirmHandle = { open: () => void };

type DialogProps = Pick<Props, 'title' | 'body' | 'confirmLabel' | 'onConfirm' | 'focusAfterId' | 'historyId'> & { onClose: () => void };

/**
 * "Remove …?" / "Cancel this invite?" in the one pop-up (UI rules §10): a sheet on a phone, a centred dialog on iPad
 * and desktop, closed by Back. Cancel + a red button named after the action. Mount it to ask; it stays open with the
 * error if the action fails.
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, focusAfterId, historyId, onClose }: DialogProps) {
  const router = useRouter();
  const ref = useRef<AdaptiveDialogHandle>(null);
  const bodyId = useId();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const failed = useRef(false);

  function confirm() {
    setError(null);
    startTransition(async () => {
      const outcome = await onConfirm();
      if (outcome.ok) {
        // The row (and with it this question) may already be gone: focus lands on a heading that stays, once the
        // pop-up has handed focus back.
        const land = () => document.getElementById(focusAfterId)?.focus();
        await ref.current?.close();
        land();
        setTimeout(land, 50);
      } else {
        failed.current = true;
        setError(outcome.code);
      }
    });
  }

  return (
    <AdaptiveDialog
      ref={ref}
      historyId={historyId}
      role="alertdialog"
      describedBy={bodyId}
      title={title}
      busy={pending}
      stackFooterOnPhone
      onClose={() => {
        // After a failure the page may be out of date (the invite was accepted meanwhile, say): refresh it once the
        // coach has read the message.
        if (failed.current) router.refresh();
        onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} pending={pending} phSafe>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p id={bodyId} className={styles.dialogBody}>{body}</p>
      {error ? <ErrorText code={error} /> : null}
    </AdaptiveDialog>
  );
}

/** A button that asks first (ConfirmDialog). With `trigger={false}` only the question, opened through `handle`. */
export function ConfirmButton({ label, ariaLabel, title, body, confirmLabel, onConfirm, focusAfterId, historyId, handle, trigger = true }: Props) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(handle, () => ({ open: () => setOpen(true) }));

  return (
    <>
      {trigger ? (
        <Button variant="secondary" className={styles.dangerOutline} aria-label={ariaLabel} onClick={() => setOpen(true)}>
          {label}
        </Button>
      ) : null}
      {open ? (
        <ConfirmDialog
          title={title}
          body={body}
          confirmLabel={confirmLabel}
          onConfirm={onConfirm}
          focusAfterId={focusAfterId}
          historyId={historyId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
