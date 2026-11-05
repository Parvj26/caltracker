'use client';

import { useActionState } from 'react';
import { Button, ErrorText, TextField } from '@/components/ui';
import { setPassword, type SetPasswordState } from './actions';
import styles from '../sign-in/sign-in.module.css';

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, { error: null });
  return (
    <form action={action} className={styles.signInForm}>
      <TextField label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      <TextField label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
      <Button type="submit" pending={pending} className={styles.submit}>{pending ? 'Saving…' : 'Set password'}</Button>
    </form>
  );
}
