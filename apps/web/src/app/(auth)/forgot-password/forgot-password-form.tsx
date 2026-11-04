'use client';

import { useActionState } from 'react';
import { Button, TextField } from '@/components/ui';
import { requestPasswordReset, type ForgotPasswordState } from './actions';
import styles from '../sign-in/sign-in.module.css';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, { done: false });
  if (state.done) {
    return <p role="status" className={styles.notice}>If that email has an account, we&apos;ve sent a link. It can take a minute to arrive.</p>;
  }
  return (
    <form action={action} className={styles.signInForm}>
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <Button type="submit" pending={pending} className={styles.submit}>{pending ? 'Sending…' : 'Send link'}</Button>
    </form>
  );
}
