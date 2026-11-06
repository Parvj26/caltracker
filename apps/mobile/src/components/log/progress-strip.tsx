import { StyleSheet, View } from 'react-native';
import { progressLabel } from '@/lib/log-page-model';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const FILL = { done: palette.ink, current: palette.magenta, todo: palette.border } as const;

type Progress = 'done' | 'current' | 'todo';

/**
 * One segment per exercise page: done, current, to-do, in groups (one per section run) with a wider gap between
 * groups. A workout without sections is one group and looks as before. One screen-reader stop for the whole strip.
 * Segment testIDs count pages across the whole strip: progress-segment-{pageIndex}-{state}.
 */
export function ProgressStrip({ groups }: { groups: ReadonlyArray<ReadonlyArray<Progress>> }) {
  const { space, radius } = useTheme();
  const states = groups.flat();
  const done = states.filter((s) => s === 'done').length;
  // The page index each group starts at, so segment testIDs stay page numbers.
  const starts = groups.reduce<number[]>((acc, _, gi) => [...acc, gi === 0 ? 0 : acc[gi - 1] + groups[gi - 1].length], []);
  return (
    <View
      testID="progress-strip"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={progressLabel(states)}
      accessibilityValue={{ min: 0, max: states.length, now: done }}
      style={[styles.row, { gap: space[3] }]}
    >
      {groups.map((group, gi) => (
        <View key={gi} style={[styles.group, { flex: group.length, gap: space[1] }]}>
          {group.map((s, i) => (
            <View
              key={i}
              testID={`progress-segment-${starts[gi] + i}-${s}`}
              style={[styles.segment, { backgroundColor: FILL[s], borderRadius: radius.pill }]}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: '100%' },
  // Each group's width follows its page count, so segments stay about the same width.
  group: { flexDirection: 'row' },
  segment: { flex: 1, height: 6 },
});
