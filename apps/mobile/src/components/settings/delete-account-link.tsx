import { Pressable, StyleSheet, Text } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** The small red "Delete account" link under Sign out (account-canvas Settings board). */
export function DeleteAccountLink({ onPress }: { onPress: () => void }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID="settings-delete-account"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Delete account"
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={[text('sectionHeading'), styles.label]}>Delete account</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', minHeight: tapTarget.min, justifyContent: 'center' },
  label: { fontSize: 15, color: palette.danger },
  pressed: { opacity: pressedOpacity },
});
