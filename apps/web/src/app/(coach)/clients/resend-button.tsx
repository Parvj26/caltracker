'use client';

import { useState, useTransition } from 'react';
import { errorMessage } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { sendInvites } from './actions';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

type Props = {
  email: string;
  firstName: string;
  lastName: string;
  /** "Resend" on pending invites, "Re-invite" on past clients. */
  label?: string;
  /** Names the row for screen readers, e.g. "Re-invite Sam Lee". */
  ariaLabel?: string;
  /** A small text button inside a row's status line (the Clients list) instead of a bordered button. */
  inline?: boolean;
};

export function ResendButton({ email, firstName, lastName, label = 'Resend', ariaLabel, inline = false }: Props) {
  const [message, setMessage] = useState<StatusView | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const outcome = await sendInvites([{ email, firstName, lastName }]);
      if (!outcome.ok) return setMessage({ text: errorMessage(outcome.code), tone: 'amber' });
      const result = outcome.results[0];
      setMessage(result ? statusView(result.status, result.message) : null);
    });
  }

  if (inline) {
    return (
      <>
        <button type="button" className={styles.inlineAction} onClick={resend} disabled={pending} aria-busy={pending || undefined} aria-label={pending ? undefined : ariaLabel}>
          {pending ? 'Sending…' : label}
        </button>
        {message ? <span role="status" className={styles.inlineStatus}><StatusChip view={message} /></span> : null}
      </>
    );
  }

  return (
    <>
      <Button variant="secondary" className={styles.rowButton} onClick={resend} pending={pending} aria-label={pending ? undefined : ariaLabel}>
        {pending ? 'Sending…' : label}
      </Button>
      {message ? <span role="status"><StatusChip view={message} /></span> : null}
    </>
  );
}
