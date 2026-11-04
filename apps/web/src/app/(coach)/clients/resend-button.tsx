'use client';

import { useState, useTransition } from 'react';
import { sendInvites } from './actions';
import { statusCopy } from './status-copy';

export function ResendButton({ email, fullName }: { email: string; fullName: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const outcome = await sendInvites([{ email, fullName }]);
      if (!outcome.ok) return setMessage(outcome.error);
      const result = outcome.results[0];
      setMessage(result ? statusCopy(result.status, result.message) : null);
    });
  }

  return (
    <>
      <button type="button" onClick={resend} disabled={pending}>{pending ? 'Sending…' : 'Resend'}</button>
      {message ? <span role="status"> {message}</span> : null}
    </>
  );
}

