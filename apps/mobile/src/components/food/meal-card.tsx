import { Pressable, StyleSheet, Text, View } from 'react-native';
import { compactMacroLine, formatMealTime, mealTitle, mealTypeTag } from '@caltracker/shared';
import type { ShownMeal } from '@/lib/food-logic';
import { photoUri } from '@/lib/outbox-files';
import { palette, pressedOpacity } from '@/theme/theme';
import { font, foodText } from './food-type';
import { ChevronIcon } from './icons';
import { MealThumb } from './meal-thumb';

const THUMB = 64;

/** One meal of the day: 64 pt photo (or a plain grey tile), name (or its type), type and time, macros. Tap to edit. */
export function MealCard({ meal, urls, onPress }: { meal: ShownMeal; urls: Record<string, string>; onPress: () => void }) {
  const local = meal.localPhoto;
  const thumb = local ? photoUri(local.thumbUri) : meal.photo ? urls[meal.photo.thumbPath] : undefined;
  // Breakfast / Lunch / Dinner / Snack come from the time (the same rule as the coach's website).
  const title = mealTitle(meal);
  const tag = mealTypeTag(meal);
  const time = `${tag ? `${tag} · ` : ''}${formatMealTime(meal.eatenAt).toUpperCase()}`;
  const macros = compactMacroLine(meal.macros);
  const status = meal.pending === 'failed' ? "Didn't save" : meal.pending === 'sending' ? 'Saving…' : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, time, macros, meal.note, status].filter(Boolean).join(', ')}
      accessibilityHint="Edit this meal"
      testID={`meal-${meal.id}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: pressedOpacity }]}
    >
      <MealThumb uri={meal.photo ? thumb : undefined} size={THUMB} radius={14} />
      <View style={styles.body}>
        <Text style={font(800, 16)}>{title}</Text>
        <Text style={[font(500, 13), foodText.muted]}>{time}</Text>
        {macros ? <Text style={font(700, 13)}>{macros}</Text> : null}
        {status ? (
          <Text style={[font(700, 12), meal.pending === 'failed' ? styles.failed : foodText.muted]} testID="meal-status">
            {status}
          </Text>
        ) : null}
      </View>
      <ChevronIcon />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 2, borderColor: palette.border, borderRadius: 18 },
  body: { flex: 1, gap: 2 },
  failed: { color: palette.magentaDeep },
});
