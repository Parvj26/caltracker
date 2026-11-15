import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { borderWidth } from '@caltracker/design-tokens';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Any link the app doesn't know (an old notification, a mistyped deep link). "Back to home" goes to "/", which opens
 * Today for a signed-in client (or sign-in when signed out), so it never lands on another dead end.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  const { text, space } = useTheme();
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={[styles.column, { gap: space[4.5], paddingHorizontal: space[6] }]}>
        <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header" testID="not-found-title">
          This page isn&apos;t available
        </Text>
        <Text style={[text('body'), styles.body]}>The link may be old, or the page has moved.</Text>
        <Pressable
          testID="not-found-home"
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={[text('screenTitle'), styles.buttonLabel]}>Back to home</Text>
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
