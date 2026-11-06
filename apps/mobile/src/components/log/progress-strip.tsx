import { StyleSheet, View } from 'react-native';
import { progressLabel } from '@/lib/log-page-model';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const FILL = { done: palette.ink, current: palette.magenta, todo: palette.border } as const;

/** One segment per exercise page: done, current, to-do. One screen-reader stop that reads the whole strip. */
export function ProgressStrip({ states }: { states: ReadonlyArray<'done' | 'current' | 'todo'> }) {
  const { space, radius } = useTheme();
  const done = states.filter((s) => s === 'done').length;
  return (
    <View
      testID="progress-strip"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={progressLabel(states)}
      accessibilityValue={{ min: 0, max: states.length, now: done }}
      style={[styles.row, { gap: space[1] }]}
    >
      {states.map((s, i) => (
        <View
          key={i}
          testID={`progress-segment-${i}-${s}`}
          style={[styles.segment, { backgroundColor: FILL[s], borderRadius: radius.pill }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: '100%' },
  segment: { flex: 1, height: 6 },
});
