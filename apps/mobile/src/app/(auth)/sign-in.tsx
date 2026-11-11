import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { LegalLinks } from '@/components/legal-links';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { ShownError } from '@/lib/error-shown';
import { isNetworkFailure } from '@/lib/network-failure';

export default function SignIn() {
  // Pre-filled when the Join screen sends someone here ("You already have an account").
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    // Never the raw auth message: the same words for an unknown email and a wrong password.
    if (err) setError({ code: isNetworkFailure(err) ? 'network_offline' : err.code === 'invalid_credentials' || err.status === 400 ? 'sign_in_failed' : 'server_error' });
    // On success the session listener routes to the app and links the workspace.
  }

  return (
    <AuthShell title="Sign in" note="Let's train!">
      <TextField
        testID="email-input"
        label="Email"
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
        secureTextEntry
        autoCapitalize="none"
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      <Button testID="submit-button" title={busy ? 'Signing in...' : 'Sign in'} onPress={() => void submit()} busy={busy} />
      <TextButton testID="go-sign-up" href="/sign-up" title="Create an account" />
      <LegalLinks />
    </AuthShell>
  );
}
