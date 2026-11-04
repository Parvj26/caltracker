'use client';

import { useActionState } from 'react';
import { setPassword, type SetPasswordState } from './actions';
import styles from '../sign-in/sign-in.module.css';

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, { error: null });
  return (
    <form action={action} className={styles.form}>
      <label>
        New password
        <input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <label>
        Confirm password
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Set password'}</button>
    </form>
  );
}
