'use client';

import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { changePassword } from './actions';
import styles from './profile.module.css';

export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    if (next !== confirm) return setError('The two passwords do not match.');
    setPending(true);
    try {
      const outcome = await changePassword({ current, next, confirm });
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(failureMessage(err, "Couldn't change your password. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        onChange={(e) => setNext(e.target.value)}
      />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <div className={styles.actions}>
        <Button type="submit" variant="secondary" pending={pending}>
          {pending ? 'Changing…' : 'Change password'}
        </Button>
        <div role="status">{done ? <p className={styles.success}>Password changed.</p> : null}</div>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
      </div>
    </form>
  );
}
