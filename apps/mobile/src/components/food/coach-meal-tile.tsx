import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { chipMacroLine, type CoachMeal } from '@caltracker/shared';
import { palette, pressedOpacity } from '@/theme/theme';
import { font } from './food-type';

/** The colour tile shown while a meal has no photo (or it hasn't loaded), picked by the meal's id so it stays put. */
export const TILE_COLOURS = [palette.drop, palette.lime, palette.blue, palette.celebrateBg] as const;
export function tileColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILE_COLOURS[h % TILE_COLOURS.length] ?? palette.surface;
}

/** One meal of the coach's grid: photo (or colour tile), name, "450 kcal · 35 g P". */
export function CoachMealTile({ meal, photoUrl, onPress }: { meal: CoachMeal; photoUrl: string | undefined; onPress: () => void }) {
  const macros = chipMacroLine(meal.macros);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[meal.name, macros].filter(Boolean).join(', ')}
      accessibilityHint="Shows the recipe"
      testID={`coach-meal-${meal.name}`}
      style={({ pressed }) => [styles.tile, pressed && { opacity: pressedOpacity }]}
    >
      <View style={[styles.photo, { backgroundColor: tileColour(meal.id) }]}>
        {photoUrl ? <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
      </View>
      <Text style={[font(800, 15), styles.name]}>{meal.name}</Text>
      <Text style={[font(700, 12), styles.macros]}>{macros}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderWidth: 2, borderColor: palette.ink, borderRadius: 18, overflow: 'hidden', backgroundColor: palette.bg },
  photo: { height: 110, borderBottomWidth: 2, borderBottomColor: palette.ink, overflow: 'hidden' },
  name: { paddingTop: 10, paddingHorizontal: 10, paddingBottom: 2, lineHeight: 18 },
  macros: { paddingHorizontal: 10, paddingBottom: 10, color: palette.inkMuted },
});
