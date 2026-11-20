import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { LegalLinks } from '@/components/legal-links';
import { Button, ErrorText, TextButton, TextField, type TextFieldHandle } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { ShownError } from '@/lib/error-shown';
import { forgotPasswordHref } from '@/lib/forgot-password';
import { emailFieldError, signIn, signInFieldErrors, type SignInFieldErrors } from '@/lib/sign-in';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Sign in (approved Patterns board, 2026-11-19): Return moves from email to password and then signs in; empty or
 * invalid fields are caught on the phone with the error under the field; the password has a show/hide eye; a sign-in
 * that hangs ends with a clear message.
 */
export default function SignIn() {
  // Pre-filled when the Join screen sends someone here ("You already have an account").
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
  const [fields, setFields] = useState<SignInFieldErrors>({});
  const passwordRef = useRef<TextFieldHandle>(null);
  const { text } = useTheme();

  async function submit() {
    if (busy) return;
    const found = signInFieldErrors(email, password);
    setFields(found);
    setError(null);
    if (found.email || found.password) return;
    setBusy(true);
    const code = await signIn(
      (e, p) => supabase.auth.signInWithPassword({ email: e, password: p }),
      email,
      password,
      // Arrived after the screen said it timed out: undo it on this phone, so the client signs in on purpose.
      () => supabase.auth.signOut({ scope: 'local' }),
    );
    setBusy(false);
    if (code) setError({ code });
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
        returnKeyType="next"
        enterKeyHint="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        onBlur={() => {
          if (email.trim() !== '') setFields((f) => ({ ...f, email: emailFieldError(email) }));
        }}
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (fields.email) setFields((f) => ({ ...f, email: undefined }));
        }}
        error={fields.email}
      />
      <TextField
        ref={passwordRef}
        testID="password-input"
        label="Password"
        password
        eyeTestID="toggle-password"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="none"
        returnKeyType="go"
        enterKeyHint="go"
        onSubmitEditing={() => void submit()}
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (fields.password) setFields((f) => ({ ...f, password: undefined }));
        }}
        error={fields.password}
      />
      {error ? <ErrorText code={error.code}>{error.text}</ErrorText> : null}
      <Button testID="submit-button" title={busy ? 'Signing in...' : 'Sign in'} onPress={() => void submit()} busy={busy} />
      <TextButton testID="go-forgot-password" href={forgotPasswordHref(email)} title="Forgot password?" />
      {/* Invite only: accounts are made from a coach's invite link, so there is no sign-up here. */}
      <Text testID="invite-only-note" style={[text('body'), styles.note]}>
        New here? Ask your coach for an invite.
      </Text>
      <LegalLinks />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  note: { color: palette.inkMuted, textAlign: 'center' },
});
