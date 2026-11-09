import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import type { IsoDate, StripDay } from '@caltracker/shared';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { font } from './food-type';

/**
 * Seven days, today last (ink). A ● under a day with meals. The arrows page back a week at a time and forward again
 * up to the week ending today; no future day is ever shown.
 */
export function DayStrip({
  days,
  selected,
  title,
  onPick,
  onOlder,
  onNewer,
  canGoOlder,
}: {
  days: StripDay[];
  selected: IsoDate;
  title: string;
  onPick: (day: IsoDate) => void;
  onOlder: () => void;
  onNewer: (() => void) | null;
  canGoOlder: boolean;
}) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <View style={styles.row}>
        <Arrow glyph="‹" label="Earlier week" testID="food-older-week" disabled={!canGoOlder} onPress={onOlder} />
        <Text style={[font(700, 14), styles.title]} testID="food-week-title">
          {title}
        </Text>
        <Arrow glyph="›" label="Later week" testID="food-newer-week" disabled={onNewer === null} onPress={() => onNewer?.()} />
      </View>
      <View style={[styles.row, { gap: 6 }]}>
        {days.map((d) => (
          <DayButton key={d.day} day={d} selected={d.day === selected} onPress={() => onPick(d.day)} />
        ))}
      </View>
    </View>
  );
}

function Arrow({ glyph, label, onPress, disabled, testID }: { glyph: string; label: string; onPress: () => void; disabled: boolean; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.arrow, disabled && styles.disabled, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={font(800, 22)}>{glyph}</Text>
    </Pressable>
  );
}

function DayButton({ day, selected, onPress }: { day: StripDay; selected: boolean; onPress: () => void }) {
  const label = `${day.dow} ${day.num}${day.isToday ? ', today' : day.hasMeals ? ', meals logged' : ''}`;
  const ink = day.isToday ? styles.onInk : !day.hasMeals ? styles.quiet : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={day.isToday ? 'food-day-today' : `food-day-${day.day}`}
      style={({ pressed }) => [
        styles.day,
        day.hasMeals ? styles.dayLogged : styles.dayEmpty,
        selected && !day.isToday && styles.daySelected,
        day.isToday && styles.dayToday,
        pressed && { opacity: pressedOpacity },
      ]}
    >
      <Text style={[font(700, 12), ink]}>{day.dow}</Text>
      <Text style={[font(800, 18), ink]}>{day.num}</Text>
      <Text style={[font(800, 12), styles.mark, ink]}>{day.hasMeals ? '●' : ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center' },
  arrow: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  day: { flex: 1, minHeight: 66, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 1, paddingVertical: 4 },
  dayLogged: { backgroundColor: palette.bg, borderColor: palette.ink },
  dayEmpty: { backgroundColor: palette.bg, borderColor: palette.border },
  daySelected: { backgroundColor: palette.lime, borderColor: palette.ink },
  dayToday: { backgroundColor: palette.ink, borderColor: palette.ink },
  onInk: { color: white },
  quiet: { color: palette.inkMuted },
  mark: { height: 14, lineHeight: 14 },
});
