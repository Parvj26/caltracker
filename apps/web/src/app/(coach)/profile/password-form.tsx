'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, TextField } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { changePassword } from './actions';
import styles from './profile.module.css';

export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next.length < PASSWORD_MIN_LENGTH) return setError('password_too_short');
    if (next !== confirm) return setError('password_mismatch');
    setPending(true);
    try {
      const outcome = await changePassword({ current, next, confirm });
      if (!outcome.ok) {
        setError(outcome.code);
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(failureCode(err, 'password_change_failed'));
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
        {error ? <ErrorText code={error} /> : null}
        {error === 'stale_deploy' ? <ReloadButton className={styles.smallButton} /> : null}
      </div>
    </form>
  );
}
