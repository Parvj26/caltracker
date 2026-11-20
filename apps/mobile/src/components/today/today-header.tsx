import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { tapTarget } from '@caltracker/design-tokens';
import { palette, pressedOpacity, TITLE_MAX_SCALE } from '@/theme/theme';
import { OfflineTitle } from '@/components/ui';
import { useTheme } from '@/theme/use-theme';

const GEAR =
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z';

/**
 * Today's header: the date, "Hi <name>", and a gear that opens Settings (a screen of its own, so Back from
 * Settings › Notifications comes back to Settings). `workspaceName` and `onSignOut` are no longer used here: Settings
 * reads the coach and signs out itself (kept so Today's call stays as it is). `offline`: the grey Offline pill beside
 * the greeting while Today shows the workouts saved on the phone.
 */
export function TodayHeader({
  date,
  greeting,
  offline = false,
}: {
  date: string;
  greeting: string;
  offline?: boolean;
  workspaceName?: string;
  onSignOut?: () => void;
}) {
  const { text, space } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.row, { gap: space[3], paddingHorizontal: space[1] }]}>
      <View style={styles.flex}>
        <Text style={[text('caption'), styles.date]} testID="today-date">
          {date}
        </Text>
        <OfflineTitle offline={offline}>
          <Text style={[text('screenTitle'), styles.greeting]} accessibilityRole="header" testID="today-greeting" maxFontSizeMultiplier={TITLE_MAX_SCALE}>
            {greeting}
          </Text>
        </OfflineTitle>
      </View>
      <Pressable
        testID="today-settings"
        onPress={() => router.push('/settings')}
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={({ pressed }) => [styles.gear, pressed && styles.pressed]}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={palette.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Circle cx={12} cy={12} r={3} />
          <Path d={GEAR} />
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  // The board's header: a 14 pt date over a 30 pt greeting.
  date: { fontSize: 14 },
  greeting: { fontSize: 30 },
  gear: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  pressed: { opacity: pressedOpacity },
});
