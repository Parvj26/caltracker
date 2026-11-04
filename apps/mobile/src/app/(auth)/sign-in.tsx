import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message);
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
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button testID="submit-button" title={busy ? 'Signing in...' : 'Sign in'} onPress={() => void submit()} busy={busy} />
      <TextButton testID="go-sign-up" href="/sign-up" title="Create an account" />
    </AuthShell>
  );
}
