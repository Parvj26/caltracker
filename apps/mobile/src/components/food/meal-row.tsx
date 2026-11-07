import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MACRO_KEYS, MACRO_SHORT, formatMacro, formatMealTime, photoDisplaySize } from '@caltracker/shared';
import { SharpPhoto } from '@/components/photo/sharp-photo';
import type { ShownMeal } from '@/lib/food-logic';
import { photoUri } from '@/lib/outbox-files';
import { palette, pressedOpacity, radius, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const THUMB = 72;

/** "650 kcal · P 42 g · C 80 g" (only what was entered). */
export function macroLine(meal: ShownMeal): string {
  return MACRO_KEYS.filter((k) => meal.macros[k] !== null)
    .map((k) => (k === 'calories' ? formatMacro(k, meal.macros[k]!) : `${MACRO_SHORT[k]} ${formatMacro(k, meal.macros[k]!)}`))
    .join(' · ');
}

/** One meal in the day's list: its photo (whole, never cropped), name and time, macros and note. Tap to edit. */
export function MealRow({ meal, urls, onPress }: { meal: ShownMeal; urls: Record<string, string>; onPress: () => void }) {
  const { text } = useTheme();
  const local = meal.localPhoto;
  const thumb = local ? photoUri(local.thumbUri) : meal.photo ? urls[meal.photo.thumbPath] : undefined;
  const full = local ? photoUri(local.fullUri) : meal.photo ? urls[meal.photo.path] : undefined;
  const size = photoDisplaySize(meal.photo ? { width: meal.photo.width, height: meal.photo.height } : null, { maxWidth: THUMB, maxHeight: THUMB });
  const title = meal.name ?? 'Meal';
  const time = formatMealTime(meal.eatenAt);
  const macros = macroLine(meal);
  const status = meal.pending === 'failed' ? "Didn't save" : meal.pending === 'sending' ? 'Saving…' : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, time, macros, meal.note, status].filter(Boolean).join(', ')}
      accessibilityHint="Edit this meal"
      testID={`meal-${meal.id}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: pressedOpacity }]}
    >
      {meal.photo ? (
        <View style={styles.thumbBox}>
          <SharpPhoto full={full} thumb={thumb} size={size} radius={radius.input} testID="meal-photo" />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={text('sectionHeading')}>
          {title} <Text style={text('caption')}>{time}</Text>
        </Text>
        {macros ? <Text style={text('body')}>{macros}</Text> : null}
        {meal.note ? <Text style={text('caption')} numberOfLines={3}>{meal.note}</Text> : null}
        {status ? (
          <Text style={[text('caption'), meal.pending === 'failed' && styles.failed]} testID="meal-status">
            {status}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[3], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: palette.border },
  thumbBox: { width: THUMB, height: THUMB, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: space[1] },
  failed: { color: palette.magentaDeep },
});
