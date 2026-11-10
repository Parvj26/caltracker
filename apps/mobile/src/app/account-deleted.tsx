import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { borderWidth } from '@caltracker/design-tokens';
import { signOutAndForget } from '@/lib/sign-out';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * "Your account has been deleted" (approved account-canvas Deleted board). Outside the signed-in area, so it stays on
 * screen while it signs out and forgets what this phone kept for the account; "Back to sign in" then opens sign-in.
 */
export default function AccountDeletedScreen() {
  const router = useRouter();
  const { text, space } = useTheme();
  const signedOut = useRef<Promise<void> | null>(null);

  useEffect(() => {
    // The account no longer exists, so signing out can fail on the server: the local session goes either way.
    signedOut.current ??= signOutAndForget().catch(() => {});
  }, []);

  async function backToSignIn() {
    await signedOut.current;
    router.replace('/sign-in');
  }

  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={[styles.column, { gap: space[4.5], paddingHorizontal: space[6] }]}>
        <Svg width={72} height={72} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={10} fill={palette.lime} />
          <Path d="M7.5 12.5l3 3 6-6.5" />
        </Svg>
        <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header" testID="account-deleted-title">
          Your account has been deleted
        </Text>
        <Text style={[text('body'), styles.body]}>Everything you saved in CalTracker is gone. Thanks for training with us.</Text>
        <Pressable
          testID="account-deleted-sign-in"
          onPress={() => void backToSignIn()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={[text('screenTitle'), styles.buttonLabel]}>Back to sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  column: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, textAlign: 'center' },
  body: { fontSize: 16, lineHeight: 23, color: palette.inkMuted, textAlign: 'center' },
  button: {
    minWidth: 240,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 17, color: white },
  pressed: { opacity: pressedOpacity },
});
