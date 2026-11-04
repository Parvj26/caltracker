'use client';

import { useActionState } from 'react';
import { requestPasswordReset, type ForgotPasswordState } from './actions';
import styles from '../sign-in/sign-in.module.css';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, { done: false });
  if (state.done) {
    return <p role="status">If that email has an account, we&apos;ve sent a link. It can take a minute to arrive.</p>;
  }
  return (
    <form action={action} className={styles.form}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send link'}</button>
    </form>
  );
}
