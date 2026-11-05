'use client';

import { useState, useTransition } from 'react';
import { InviteInput } from '@caltracker/shared';
import { Button, ErrorText, TextField } from '@/components/ui';
import { sendInvites } from './actions';
import { statusView, type StatusView } from './status-copy';
import { StatusChip } from './status-chip';
import styles from './clients.module.css';

type FieldError = { field: 'firstName' | 'lastName' | 'email'; message: string };

const FIELD_MESSAGES: Record<FieldError['field'], string> = {
  firstName: 'Enter a first name (1 to 100 characters).',
  lastName: 'Last name can be at most 100 characters.',
  email: 'Enter a valid email address.',
};

export function AddClientForm() {
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus(null);
    setError(null);
    const field = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    const parsed = InviteInput.safeParse({
      firstName: field('firstName'),
      lastName: field('lastName'),
      email: field('email'),
    });
    if (!parsed.success) {
      // Report the first bad field in form order.
      const bad = (['firstName', 'lastName', 'email'] as const).find((f) =>
        parsed.error.issues.some((i) => i.path[0] === f),
      ) ?? 'firstName';
      setFieldError({ field: bad, message: FIELD_MESSAGES[bad] });
      return;
    }
    setFieldError(null);
    startTransition(async () => {
      const outcome = await sendInvites([parsed.data]);
      if (!outcome.ok) return setError(outcome.error);
      const result = outcome.results[0];
      setStatus(result ? statusView(result.status, result.message) : null);
      if (result && (result.status === 'sent' || result.status === 'resent')) form.reset();
    });
  }

  // One error line under the form keeps the fields and button aligned; the bad field is marked invalid and points at it.
  const invalid = (name: FieldError['field']) =>
    fieldError?.field === name ? { 'aria-invalid': true, 'aria-describedby': 'add-client-error' } : {};
  const message = fieldError?.message ?? error;

  return (
    <section className={styles.panelSection} aria-labelledby="add-client-heading">
      <h2 id="add-client-heading" className={styles.sectionHeading}>Add client</h2>
      <form onSubmit={onSubmit} className={styles.form} noValidate>
        <TextField label="First name" name="firstName" autoComplete="off" className={styles.nameField} {...invalid('firstName')} />
        <TextField label="Last name" name="lastName" autoComplete="off" className={styles.nameField} {...invalid('lastName')} />
        <TextField label="Email" name="email" type="email" autoComplete="off" className={styles.formField} {...invalid('email')} />
        <Button type="submit" pending={pending} className={styles.formButton}>{pending ? 'Sending…' : 'Send invite'}</Button>
      </form>
      {message ? <ErrorText id="add-client-error">{message}</ErrorText> : null}
      {status ? <p role="status" className={styles.status}><StatusChip view={status} /></p> : null}
    </section>
  );
}
