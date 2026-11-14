'use client';

import { useActionState, useState } from 'react';
import { Button, ErrorText, TextField } from '@/components/ui';
import { signIn, type SignInState } from './actions';
import styles from './sign-in.module.css';

export function SignInForm() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { code: null });
  // Controlled, because React resets a form's uncontrolled fields after its action runs: a wrong password would
  // otherwise wipe the email too. The password is left uncontrolled so it does clear.
  const [email, setEmail] = useState('');
  return (
    <form action={action} className={styles.signInForm}>
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
      {state.code ? <ErrorText code={state.code} /> : null}
      <Button type="submit" pending={pending} className={styles.submit}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
      <a href="/forgot-password" className={styles.forgot}>Forgot password?</a>
    </form>
  );
}
