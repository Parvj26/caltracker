import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth } from '@caltracker/design-tokens';
import { bestsList, localToday, personalBestRows } from '@caltracker/shared';
import { LoadState, OfflineNote, SectionHeader } from '@/components/progress/parts';
import { Screen } from '@/components/ui';
import { deviceZone } from '@/lib/progress-hub-api';
import { useHub, usePullRefresh } from '@/lib/use-progress-data';
import { useUnits } from '@/lib/use-units';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/** Personal bests: the best lift for each exercise (from the stored records), newest first. A row opens its history. */
export default function BestsScreen() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const units = useUnits() ?? 'lb';
  const pull = usePullRefresh();
  const hub = useHub(pull.refreshKey);
  const today = localToday();
  const rows = useMemo(() => (hub.data ? bestsList(personalBestRows(hub.data.records), units, today, deviceZone()) : []), [hub.data, units, today]);

  return (
    <Screen refreshing={pull.refreshing} onRefresh={pull.onRefresh}>
      <View style={{ gap: space[3.5] }}>
        <SectionHeader title="Personal bests" />
        <OfflineNote show={hub.status === 'offline' && hub.data !== null} />
        <LoadState status={hub.status} hasData={hub.data !== null} onRetry={pull.onRefresh} busy={pull.refreshing} />
        <Text style={text('caption')}>Your best lift for each exercise. Tap one to see its history.</Text>
        {hub.data && rows.length === 0 ? (
          <Text style={text('body')} testID="bests-empty">
            No personal bests yet. Finish a workout with weights and your first ones show here.
          </Text>
        ) : null}
        {rows.map((r) => (
          <Pressable
            key={r.exerciseId}
            testID={`best-${r.exerciseId}`}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}: ${r.value}, ${r.detail}, ${r.when}`}
            accessibilityHint="Opens its strength history"
            onPress={() => router.push({ pathname: '/progress-detail/strength', params: { exercise: r.exerciseId } })}
            style={({ pressed }) => [styles.row, { borderRadius: radius.button, padding: space[3], gap: space[3] }, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.grow}>
              <Text style={text('sectionHeading')}>{r.name}</Text>
              <Text style={text('caption')}>{r.detail}</Text>
            </View>
            <View style={styles.end}>
              <Text style={text('sectionHeading')}>{r.value}</Text>
              <Text style={text('caption')}>{r.when}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderWidth: borderWidth.card, borderColor: palette.border },
  grow: { flex: 1 },
  end: { alignItems: 'flex-end' },
});
