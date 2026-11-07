import { StyleSheet, Text, View } from 'react-native';
import { MACRO_KEYS, MACRO_NAMES, formatMacro, hasAnyTarget, macroProgress, type DailyTotals, type MacroKey, type MacroTargets } from '@caltracker/shared';
import { palette, radius, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const FILL: Record<MacroKey, string> = { calories: palette.lime, protein: palette.pink, carbs: palette.blue, fat: palette.tape };

/** "1,240 of 2,000 kcal" with a bar, or the plain total when there is no target for it. */
function MacroBar({ macro, total, target }: { macro: MacroKey; total: number; target: number | null }) {
  const { text } = useTheme();
  const p = macroProgress(total, target);
  const amount = p.target === null ? formatMacro(macro, total) : `${formatMacro(macro, total).replace(/ (kcal|g)$/, '')} of ${formatMacro(macro, p.target)}`;
  const over = p.over ? ' · over' : '';
  return (
    <View style={styles.row} testID={`food-bar-${macro}`}>
      <View style={styles.labels}>
        <Text style={text('sectionHeading')}>{MACRO_NAMES[macro]}</Text>
        <Text style={text('caption')} testID={`food-total-${macro}`}>
          {amount}
          {over}
        </Text>
      </View>
      {p.fraction !== null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(p.fraction * 100)}%`, backgroundColor: FILL[macro] }, p.over && styles.overFill]} />
        </View>
      ) : null}
    </View>
  );
}

/** The day's totals against the coach's targets. */
export function MacroBars({ totals, targets }: { totals: DailyTotals; targets: MacroTargets | null }) {
  const { text } = useTheme();
  const any = hasAnyTarget(targets);
  return (
    <View style={styles.wrap}>
      {!any ? (
        <Text style={text('caption')} testID="food-no-targets">
          No targets yet. Your coach can set daily calories and macros for you.
        </Text>
      ) : null}
      {MACRO_KEYS.map((k) => (
        <MacroBar key={k} macro={k} total={totals[k]} target={any ? (targets?.[k] ?? null) : null} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  row: { gap: space[1] },
  labels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[2] },
  track: { height: space[3], borderRadius: radius.pill, backgroundColor: palette.surface, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  overFill: { backgroundColor: palette.amber },
});
