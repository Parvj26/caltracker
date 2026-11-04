'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from './actions';
import styles from './sign-in.module.css';

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  return (
    <form action={action} className={styles.form}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error ? <p role="alert" className={styles.error}>{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      <a href="/forgot-password">Forgot password?</a>
    </form>
  );
}
