import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FirstName, LastName } from '@caltracker/shared';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { ShownError } from '@/lib/error-shown';
import { isNetworkFailure } from '@/lib/network-failure';

export default function SignUp() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);

  async function submit() {
    const cleanEmail = email.trim();
    const first = FirstName.safeParse(firstName);
    if (!first.success) return setError({ code: 'join_first_name_invalid', text: 'Enter your first name (up to 100 characters).' });
    const last = LastName.safeParse(lastName);
    if (!last.success) return setError({ code: 'invite_last_name_invalid' });
    if (password.length < 8) return setError({ code: 'password_too_short', text: 'Password must be at least 8 characters.' });
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: { first_name: first.data, last_name: last.data },
        emailRedirectTo: 'caltracker://auth/confirmed',
      },
    });
    setBusy(false);
    // Never the raw auth message: only a code and our own words.
    if (err) return setError({ code: isNetworkFailure(err) ? 'network_offline' : err.code === 'user_already_exists' ? 'account_exists' : err.code === 'weak_password' ? 'password_weak' : 'sign_up_failed' });
    router.replace({ pathname: '/check-email', params: { email: cleanEmail } });
  }

  return (
    <AuthShell title="Create your account" note="Your coach is waiting!">
      {/* "name-input" is the first name: the Maestro flows have always used that id. */}
      <TextField
        testID="name-input"
        label="First name"
        textContentType="givenName"
        autoComplete="given-name"
        value={firstName}
        onChangeText={setFirstName}
      />
      <TextField
        testID="last-name-input"
        label="Last name"
        hint="Optional if you use one name."
        textContentType="familyName"
        autoComplete="family-name"
        value={lastName}
        onChangeText={setLastName}
      />
      <TextField
        testID="email-input"
        label="Email"
        hint="Use the email your coach invited."
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="none"
        value={email}
        onChangeText={setEmail}
      />
      <TextField
        testID="password-input"
        label="Password"
        hint="At least 8 characters."
        secureTextEntry
        autoCapitalize="none"
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      <Button
        testID="submit-button"
        title={busy ? 'Creating account...' : 'Create account'}
        onPress={() => void submit()}
        busy={busy}
      />
      <TextButton testID="go-sign-in" href="/sign-in" title="I already have an account" />
    </AuthShell>
  );
}
