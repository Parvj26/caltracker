'use client';

import { useActionState } from 'react';
import { Button, ErrorText, TextField } from '@/components/ui';
import { signIn, type SignInState } from './actions';
import styles from './sign-in.module.css';

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  return (
    <form action={action} className={styles.signInForm}>
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
      <Button type="submit" pending={pending} className={styles.submit}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <a href="/forgot-password" className={styles.forgot}>Forgot password?</a>
    </form>
  );
}
