import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Logo, Screen, TextButton } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useActiveLog } from '@/lib/use-active-log';
import { signOutAndForget } from '@/lib/sign-out';
import { useTheme } from '@/theme/use-theme';

/** Shown only while the client has no coach: never invited, or removed. With a coach they get the tabs. */
export default function Home() {
  const { removedFromWorkspace, claimError, recheck } = useSession();
  // e.g. "You're no longer with …, so this workout wasn't saved." after a removal mid-workout.
  const { banner, dismissBanner } = useActiveLog();
  const { text } = useTheme();
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    await recheck();
    setChecking(false);
  }

  return (
    <Screen>
      <Logo />
      {banner ? (
        <Card>
          <Text testID="log-note" style={text('sectionHeading')}>
            {banner}
          </Text>
          <TextButton testID="log-note-ok" title="OK" onPress={dismissBanner} />
        </Card>
      ) : null}
      <Card>
        <Text style={text('screenTitle')} accessibilityRole="header">
          Ask your coach for an invite
        </Text>
        <Text style={text('body')} testID="no-coach-explain">
          {removedFromWorkspace
            ? `You're no longer connected to ${removedFromWorkspace}. If that's a mistake, ask your coach to invite you again.`
            : 'Your coach needs to invite this email before you can join their workspace.'}
        </Text>
        {claimError ? <ErrorText code="claim_failed">{claimError}</ErrorText> : null}
        <Button testID="check-again" title="Check again" onPress={() => void checkAgain()} busy={checking} />
      </Card>
      <TextButton testID="sign-out" title="Sign out" onPress={() => void signOutAndForget()} />
    </Screen>
  );
}
