'use client';

import { useState, useTransition } from 'react';
import { errorMessage } from '@caltracker/shared';
import { Button } from '@/components/ui';
import { sendInvites } from './actions';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';

type Props = {
  email: string;
  firstName: string;
  lastName: string;
  /** "Resend" on pending invites, "Re-invite" on past clients. */
  label?: string;
  /** Names the row for screen readers, e.g. "Re-invite Sam Lee". */
  ariaLabel?: string;
};

/** Sends an invite again; `message` is the result to show (a chip). Shared by Resend buttons and row menus. */
export function useResendInvite({ email, firstName, lastName }: { email: string; firstName: string; lastName: string }) {
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
  return { resend, pending, message };
}

export function ResendButton({ email, firstName, lastName, label = 'Resend', ariaLabel }: Props) {
  const { resend, pending, message } = useResendInvite({ email, firstName, lastName });
  return (
    <>
      <Button variant="quiet" size="compact" onClick={resend} pending={pending} aria-label={pending ? undefined : ariaLabel}>
        {pending ? 'Sending…' : label}
      </Button>
      {message ? <span role="status"><StatusChip view={message} /></span> : null}
    </>
  );
}
