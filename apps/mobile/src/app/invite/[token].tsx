import { FirstName, LastName, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordBytes } from '@caltracker/shared';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField } from '@/components/ui';
import { joinInvite, joinMessage, loadInvite, type InviteDetails, type JoinFailure } from '@/lib/join-invite';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

// Opened by caltracker://invite/{token} (the "Open in CalTracker" button on the web invite page).
// The client sees the coach's details pre-filled and only chooses a password; there is no confirmation email.
// Design: docs/superpowers/specs/2026-11-05-invite-join-design.md

/** Reasons that mean "you have an account now, or already had one": offer Sign in with the email filled in. */
const SIGN_IN_REASONS: JoinFailure['reason'][] = ['account_exists', 'used', 'joined_sign_in_failed'];

export default function JoinInvite() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { session } = useSession();
  const { text, space } = useTheme();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<JoinFailure | null>(null);

  const load = useCallback(async () => {
    setInvite(null);
    const details = await loadInvite(supabase, token);
    setInvite(details);
    if (details.status === 'valid') {
      setFirstName(details.firstName);
      setLastName(details.lastName);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const goSignIn = (email?: string) => router.replace({ pathname: '/sign-in', params: email ? { email } : {} });

  async function submit() {
    if (invite?.status !== 'valid') return;
    const first = FirstName.safeParse(firstName);
    if (!first.success) return setError('Enter your first name (up to 100 characters).');
    const last = LastName.safeParse(lastName);
    if (!last.success) return setError('Last name can be at most 100 characters.');
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    // The limit counts bytes: accented letters and emoji take more than one.
    if (passwordBytes(password) > PASSWORD_MAX_LENGTH) return setError('That password is too long. Try a shorter one.');
    setBusy(true);
    setError(null);
    setFailure(null);
    const result = await joinInvite(supabase, {
      token: token ?? '',
      password,
      firstName: first.data,
      lastName: last.data,
    });
    setBusy(false);
    if (result.ok) {
      // Signed in: the session listener links the coach, and "/" routes to Today.
      setJoined(true);
      router.replace('/');
      return;
    }
    setFailure(result);
    setError(joinMessage(result.reason, invite.workspaceName));
  }

  if (joined || invite === null) {
    return (
      <AuthShell title="Your invite">
        <ActivityIndicator color={palette.ink} accessibilityLabel="Loading your invite" />
      </AuthShell>
    );
  }

  if (invite.status === 'offline') {
    return (
      <AuthShell title="Your invite">
        <ErrorText>{joinMessage('offline', '')}</ErrorText>
        <Button testID="retry" title="Try again" onPress={() => void load()} />
      </AuthShell>
    );
  }

  if (invite.status !== 'valid') {
    const title = invite.status === 'expired' ? 'Invite expired' : invite.status === 'used' ? 'Invite already used' : 'Invite not valid';
    return (
      <AuthShell title={title}>
        <Text style={text('body')} testID="invite-problem">
          {joinMessage(invite.status, '')}
        </Text>
        <Button testID="go-sign-in" title="Go to sign in" onPress={() => goSignIn()} />
      </AuthShell>
    );
  }

  // Someone else is signed in on this phone: joining would switch accounts, so ask first.
  if (session && session.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return (
      <AuthShell title={`Join ${invite.workspaceName}`}>
        <Text style={text('body')}>
          {`You're signed in as ${session.user.email ?? 'another account'}. Sign out to join ${invite.workspaceName} as ${invite.email}?`}
        </Text>
        <Button testID="sign-out-to-join" title="Sign out" onPress={() => void supabase.auth.signOut()} />
        <TextButton testID="stay-signed-in" title="Stay signed in" onPress={() => router.replace('/')} />
      </AuthShell>
    );
  }
  // Already signed in with the invited email: signing in links the coach, so just go in.
  if (session) return <Redirect href="/" />;

  const offerSignIn = failure !== null && SIGN_IN_REASONS.includes(failure.reason);
  return (
    <AuthShell title={`Join ${invite.workspaceName}`} note="Your coach is waiting!">
      <View style={{ gap: space[1] }}>
        <Text style={text('sectionHeading')}>Email</Text>
        <Text style={text('body')} testID="invite-email">{`You'll sign in with ${invite.email}`}</Text>
      </View>
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
        testID="password-input"
        label="Create a password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />
      <TextButton
        testID="toggle-password"
        title={showPassword ? 'Hide password' : 'Show password'}
        onPress={() => setShowPassword((s) => !s)}
      />
      {error ? <ErrorText testID="join-error">{error}</ErrorText> : null}
      {offerSignIn ? (
        <Button
          testID="go-sign-in"
          title="Go to sign in"
          onPress={() => goSignIn(failure.reason === 'joined_sign_in_failed' ? failure.email : invite.email)}
        />
      ) : (
        <Button testID="join-button" title={busy ? 'Joining...' : 'Join'} onPress={() => void submit()} busy={busy} />
      )}
    </AuthShell>
  );
}
