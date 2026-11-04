import { useRouter } from 'expo-router';
import { useState } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const cleanEmail = email.trim();
    if (!name.trim()) return setError('Enter your name.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { full_name: name.trim() }, emailRedirectTo: 'caltracker://auth/confirmed' },
    });
    setBusy(false);
    if (err) return setError(err.message);
    router.replace({ pathname: '/check-email', params: { email: cleanEmail } });
  }

  return (
    <AuthShell title="Create your account" note="Your coach is waiting!">
      <TextField testID="name-input" label="Full name" textContentType="none" value={name} onChangeText={setName} />
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
      {error ? <ErrorText>{error}</ErrorText> : null}
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
