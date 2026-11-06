import { StyleSheet, Text, View } from 'react-native';
import type { SyncStatus } from '@/lib/log-sync';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** "Not synced yet" while changes wait to upload; nothing once they have. Ticked sets are safe on the phone either way. */
export function SyncPill({ status }: { status: SyncStatus }) {
  const { text, space, radius } = useTheme();
  if (status === 'synced') return null;
  return (
    <View
      testID="sync-pill"
      accessibilityRole="text"
      accessibilityLabel="Not synced yet. Your sets are saved on this phone."
      style={[styles.pill, { borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[1] }]}
    >
      {/* Text on a pastel tile is always ink, never muted. */}
      <Text style={[text('caption'), styles.ink]}>Not synced yet</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'center', backgroundColor: palette.tape },
  ink: { color: palette.ink },
});
