import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { settingsSummary } from '@/lib/notification-settings-logic';
import { usePush } from '@/lib/use-push';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { BellIcon, ChevronIcon } from './icons';

/** The Settings sheet's "Notifications ›" row: bell, the current state ("On · Quiet 10 PM – 7 AM") and a chevron. */
export function NotificationsRow({ onPress }: { onPress: () => void }) {
  const { text, space, radius } = useTheme();
  const { prefs, permission } = usePush();
  const summary = settingsSummary(prefs, permission);
  return (
    <Pressable
      testID="settings-notifications"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Notifications, ${summary}`}
      style={({ pressed }) => [
        styles.row,
        { gap: space[3], paddingHorizontal: space[4], borderRadius: radius.card },
        pressed && styles.pressed,
      ]}
    >
      <BellIcon />
      <View style={styles.flex}>
        <Text style={text('sectionHeading')}>Notifications</Text>
        <Text style={text('caption')} testID="settings-notifications-summary">
          {summary}
        </Text>
      </View>
      <ChevronIcon />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    borderWidth: borderWidth.card,
    borderColor: palette.ink,
    backgroundColor: palette.drop,
  },
  flex: { flex: 1 },
  pressed: { opacity: pressedOpacity },
});
