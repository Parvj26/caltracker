'use client';

import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/actions-shared';
import { Button, ErrorText } from './ui';
import styles from './admin.module.css';

type Report = (message: string) => void;
const StatusContext = createContext<Report | null>(null);

/**
 * One "done" line for a group of actions (a panel or a table). It sits outside the rows, so the message stays even
 * when the action removes its own row (a resent invite leaves "Needs attention").
 */
export function ActionStatus({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <StatusContext.Provider value={setMessage}>
      {message ? <p role="status" className={styles.status}>✓ {message}</p> : null}
      {children}
    </StatusContext.Provider>
  );
}

/** The nearest ActionStatus's reporter (null outside one), for actions with their own dialog or form. */
export function useActionStatus(): Report | null {
  return useContext(StatusContext);
}

/**
 * A support action behind a confirm dialog. `action` runs only after Confirm; its fields (children with `name`) are
 * sent as FormData. Errors stay in the dialog; success closes it, reports to the nearest ActionStatus and refreshes.
 */
export function ConfirmAction({
  label,
  title,
  confirmLabel,
  action,
  children,
  look = 'button',
  className,
  disabled = false,
}: {
  label: string;
  title: string;
  confirmLabel: string;
  action: (formData: FormData) => Promise<ActionResult>;
  children?: ReactNode;
  look?: 'button' | 'link';
  className?: string | undefined;
  /** The opening button is disabled (say why next to it). */
  disabled?: boolean;
}) {
  const report = useContext(StatusContext);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ownMessage, setOwnMessage] = useState<string | null>(null);

  function open() {
    setError(null);
    dialog.current?.showModal();
  }

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await action(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dialog.current?.close();
    if (report) report(result.message);
    else setOwnMessage(result.message);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={open} disabled={disabled} className={className ?? (look === 'link' ? styles.linkButton : styles.actionButton)}>
        {label}
      </button>
      {ownMessage ? <p role="status" className={styles.status}>✓ {ownMessage}</p> : null}
      <dialog ref={dialog} aria-labelledby={titleId} className={styles.dialog}>
        <form action={(fd) => void onSubmit(fd)} className={styles.dialogForm}>
          <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
          <div className={styles.dialogBody}>{children}</div>
          <p className={styles.panelNote}>This goes in the audit log.</p>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <div className={styles.dialogActions}>
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button>
            <Button type="submit" pending={pending}>{confirmLabel}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
