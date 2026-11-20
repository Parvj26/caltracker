import { FirstName, LastName, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordBytes } from '@caltracker/shared';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { AuthShell } from '@/components/auth-shell';
import { Button, ErrorText, TextButton, TextField, type TextFieldHandle } from '@/components/ui';
import { joinCode, joinInvite, joinMessage, loadInvite, type InviteDetails, type JoinFailure } from '@/lib/join-invite';
import { useSession } from '@/lib/session';
import { signOutAndForget } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import type { ShownError } from '@/lib/error-shown';
import type { ErrorCode } from '@caltracker/shared';

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
  // Errors checked on the phone, each shown under its field.
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: ErrorCode; lastName?: ErrorCode; password?: ErrorCode }>({});
  const lastRef = useRef<TextFieldHandle>(null);
  const passwordRef = useRef<TextFieldHandle>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<ShownError | null>(null);
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
    if (invite?.status !== 'valid' || busy) return;
    const first = FirstName.safeParse(firstName);
    const last = LastName.safeParse(lastName);
    const found = {
      firstName: first.success ? undefined : ('join_first_name_invalid' as const),
      lastName: last.success ? undefined : ('invite_last_name_invalid' as const),
      // The limit counts bytes: accented letters and emoji take more than one.
      password:
        password.length < PASSWORD_MIN_LENGTH ? ('password_too_short' as const) : passwordBytes(password) > PASSWORD_MAX_LENGTH ? ('password_too_long' as const) : undefined,
    };
    setFieldErrors(found);
    setError(null);
    if (!first.success || !last.success || found.password) return;
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
    setError({ code: joinCode(result.reason), text: joinMessage(result.reason, invite.workspaceName) });
  }

  if (joined || invite === null) {
    return (
      <AuthShell title="Your invite">
        <ActivityIndicator color={palette.ink} accessibilityLabel="Loading your invite" />
      </AuthShell>
    );
  }

  if (invite.status === 'offline' || invite.status === 'server') {
    return (
      <AuthShell title="Your invite">
        <ErrorText code={joinCode(invite.status)}>{joinMessage(invite.status, '')}</ErrorText>
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
        <Button testID="sign-out-to-join" title="Sign out" onPress={() => void signOutAndForget()} />
        <TextButton testID="stay-signed-in" title="Stay signed in" onPress={() => router.replace('/')} />
      </AuthShell>
    );
  }
  // Already signed in with the invited email (e.g. a removed client tapping a new invite). Tapping the link is the
  // client's choice, so accept the invite now; opening the app on its own never joins a coach.
  if (session) return <AcceptAndEnter />;

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
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => lastRef.current?.focus()}
        value={firstName}
        onChangeText={(v) => {
          setFirstName(v);
          setFieldErrors((f) => ({ ...f, firstName: undefined }));
        }}
        error={fieldErrors.firstName}
      />
      <TextField
        ref={lastRef}
        testID="last-name-input"
        label="Last name"
        hint="Optional if you use one name."
        textContentType="familyName"
        autoComplete="family-name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        value={lastName}
        onChangeText={(v) => {
          setLastName(v);
          setFieldErrors((f) => ({ ...f, lastName: undefined }));
        }}
        error={fieldErrors.lastName}
      />
      <TextField
        ref={passwordRef}
        testID="password-input"
        label="Create a password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        password
        eyeTestID="toggle-password"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setFieldErrors((f) => ({ ...f, password: undefined }));
        }}
        error={fieldErrors.password}
      />
      {error ? <ErrorText testID="join-error" code={error.code}>{error.text}</ErrorText> : null}
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

/** Accepts the pending invite for the signed-in email once, then enters the app. */
function AcceptAndEnter() {
  const { recheck } = useSession();
  const [done, setDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void recheck().finally(() => {
      if (!cancelled) setDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [recheck]);
  if (done) return <Redirect href="/" />;
  return (
    <AuthShell title="Your invite">
      <ActivityIndicator color={palette.ink} accessibilityLabel="Joining your coach" />
    </AuthShell>
  );
}
