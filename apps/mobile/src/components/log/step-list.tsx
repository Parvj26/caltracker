import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StepRowModel } from '@/lib/log-page-model';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export const WARMUP_NOTE = "Warm-ups don't count towards volume or personal bests.";

/**
 * Every step of the page in order: W rows on the lighter surface, drops on the drop pastel, ticked rows with their
 * result and ✓, the current one marked "next". `renderCurrent` swaps the current row for live controls (drop sets).
 * `labels` are the superset labels (A1, A2) by exercise index.
 */
export function StepList({
  steps,
  page,
  showWarmupNote,
  heading,
  labels,
  renderCurrent,
}: {
  steps: StepRowModel[];
  page: number;
  showWarmupNote: boolean;
  heading?: string;
  labels?: Array<string | null>;
  renderCurrent?: (row: StepRowModel) => ReactNode;
}) {
  const { text, space, radius } = useTheme();
  return (
    <View testID={`step-list-${page}`} style={{ gap: space[2] }}>
      {heading ? (
        <Text style={text('caption')} accessibilityRole="header">
          {heading}
        </Text>
      ) : null}
      {steps.map((row) => {
        const custom = row.current ? renderCurrent?.(row) : null;
        if (custom) return <View key={row.setId}>{custom}</View>;
        const label = labels?.[row.exerciseIndex];
        const name = label ? `${label} ${row.name}` : row.name;
        const state = row.done ? 'done' : row.current ? 'next' : 'to do';
        return (
          <View
            key={row.setId}
            testID={`step-row-${page}-${row.exerciseIndex}-${row.setIndex}`}
            accessible
            accessibilityLabel={`${name}${row.text ? `, ${row.text}` : ''}, ${state}`}
            style={[
              styles.row,
              { gap: space[2.5], padding: space[2.5], borderRadius: radius.input },
              row.kind === 'warmup' && styles.warmup,
              row.kind === 'drop' && styles.drop,
              row.done && styles.done,
              row.current && styles.current,
            ]}
          >
            <View style={[styles.chip, { borderRadius: radius.pill }]}>
              <Text style={[text('sectionHeading'), styles.ink]}>{row.chip}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={[text('body'), styles.ink]}>{name}</Text>
              {row.text ? <Text style={[text('caption'), styles.ink]}>{row.text}</Text> : null}
            </View>
            {row.done ? <Text style={[text('sectionHeading'), styles.ink]}>✓</Text> : null}
            {row.current ? <Text style={[text('caption'), styles.ink]}>next</Text> : null}
          </View>
        );
      })}
      {showWarmupNote ? <Text style={text('caption')}>{WARMUP_NOTE}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bg, borderWidth: 2, borderColor: palette.border },
  warmup: { backgroundColor: palette.surface },
  drop: { backgroundColor: palette.drop },
  done: { backgroundColor: palette.lime, borderColor: palette.lime },
  current: { borderColor: palette.ink },
  chip: { minWidth: 28, alignItems: 'center', backgroundColor: palette.bg },
  flex: { flex: 1 },
  ink: { color: palette.ink },
});
