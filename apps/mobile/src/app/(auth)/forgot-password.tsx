import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { RESET_SENT, requestPasswordReset } from '@/lib/forgot-password';
import { supabase } from '@/lib/supabase';
import type { ShownError } from '@/lib/error-shown';
import { useTheme } from '@/theme/use-theme';

// "Forgot password?" from sign-in. The emailed link opens the website to set a new password; then sign in here.
export default function ForgotPassword() {
  // Pre-filled with the email typed on sign-in, if any.
  const params = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const { text } = useTheme();

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await requestPasswordReset(supabase, email);
    setBusy(false);
    if (result.ok) setSent(true);
    else setError({ code: result.code });
  }

  return (
    <AuthShell title="Reset your password" note="It happens!">
      {sent ? (
        <>
          <Text testID="reset-sent" style={text('body')} accessibilityLiveRegion="polite">
            {RESET_SENT}
          </Text>
          <Text style={text('body')}>Open the link to set a new password, then come back here and sign in.</Text>
        </>
      ) : (
        <>
          <Text style={text('body')}>Enter your email and we'll send you a link to set a new password.</Text>
          <TextField
            testID="reset-email-input"
            label="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            value={email}
            onChangeText={setEmail}
          />
          {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
          <Button testID="reset-submit" title={busy ? 'Sending...' : 'Send link'} onPress={() => void submit()} busy={busy} />
        </>
      )}
      {/* Back to the sign-in screen underneath (keeps what was typed there); a fresh one if opened directly. */}
      <TextButton
        testID="go-sign-in"
        title="Back to sign in"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
      />
    </AuthShell>
  );
}
