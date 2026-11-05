import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, ErrorText, HandNote, Logo, Screen, TextButton } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/theme/use-theme';

export default function Home() {
  const { workspace, claimError, recheck } = useSession();
  const { text, space } = useTheme();
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    await recheck();
    setChecking(false);
  }

  return (
    <Screen>
      <Logo />
      <Card>
        {workspace ? (
          <>
            <View style={{ gap: space[2] }}>
              <Text style={text('screenTitle')} accessibilityRole="header">{`Welcome to ${workspace.workspaceName}`}</Text>
              <HandNote>{"Let's train!"}</HandNote>
            </View>
            <Text style={text('body')}>Your coach will add your workouts here soon.</Text>
          </>
        ) : (
          <>
            <Text style={text('screenTitle')} accessibilityRole="header">
              Ask your coach for an invite
            </Text>
            <Text style={text('body')}>Your coach needs to invite this email before you can join their workspace.</Text>
            {claimError ? <ErrorText>{claimError}</ErrorText> : null}
            <Button testID="check-again" title="Check again" onPress={() => void checkAgain()} busy={checking} />
          </>
        )}
      </Card>
      <TextButton testID="sign-out" title="Sign out" onPress={() => void supabase.auth.signOut()} />
    </Screen>
  );
}
