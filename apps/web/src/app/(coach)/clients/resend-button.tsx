'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { sendInvites } from './actions';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

export function ResendButton({ email, firstName, lastName }: { email: string; firstName: string; lastName: string }) {
  const [message, setMessage] = useState<StatusView | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const outcome = await sendInvites([{ email, firstName, lastName }]);
      if (!outcome.ok) return setMessage({ text: outcome.error, tone: 'amber' });
      const result = outcome.results[0];
      setMessage(result ? statusView(result.status, result.message) : null);
    });
  }

  return (
    <>
      <Button variant="secondary" className={styles.rowButton} onClick={resend} pending={pending}>
        {pending ? 'Sending…' : 'Resend'}
      </Button>
      {message ? <span role="status"><StatusChip view={message} /></span> : null}
    </>
  );
}
