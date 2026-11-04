'use client';

import { useState, useTransition } from 'react';
import { InviteInput } from '@caltracker/shared';
import { sendInvites } from './actions';
import { statusCopy } from './status-copy';
import styles from './clients.module.css';

export function AddClientForm() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus(null);
    const field = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    const parsed = InviteInput.safeParse({ fullName: field('fullName'), email: field('email') });
    if (!parsed.success) {
      const emailBad = parsed.error.issues.some((i) => i.path[0] === 'email');
      setError(emailBad ? 'Enter a valid email address.' : 'Enter a name (1 to 100 characters).');
      return;
    }
    setError(null);
    startTransition(async () => {
      const outcome = await sendInvites([parsed.data]);
      if (!outcome.ok) return setError(outcome.error);
      const result = outcome.results[0];
      setStatus(result ? statusCopy(result.status, result.message) : null);
      if (result && (result.status === 'sent' || result.status === 'resent')) form.reset();
    });
  }

  return (
    <section>
      <h2>Add client</h2>
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <label>
          Name
          <input name="fullName" autoComplete="off" />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="off" />
        </label>
        <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send invite'}</button>
      </form>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
