import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MACRO_KEYS, formatMacro, type MacroKey } from '@caltracker/shared';
import { tileColour } from '@/components/food/coach-meal-tile';
import { font, foodText, inkShadow } from '@/components/food/food-type';
import { BackIcon } from '@/components/food/icons';
import { Button, Screen } from '@/components/ui';
import { coachMealPhotoUrls } from '@/lib/coach-meals-api';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity } from '@/theme/theme';

const LABEL: Record<MacroKey, string> = { calories: 'kcal', protein: 'protein', carbs: 'carbs', fat: 'fat' };

/** A coach meal: photo, name, the four numbers ("—" when blank), ingredients and how to make it, and Log this meal. */
export default function CoachMealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const food = useFood();
  const { id } = useLocalSearchParams<{ id: string }>();
  const meal = food?.coachMeals.find((m) => m.id === id) ?? null;
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);

  const path = meal?.photo?.path ?? null;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void coachMealPhotoUrls([path]).then((u) => alive && setPhotoUrl(u[path]));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!food) return null;
  if (!meal) {
    return (
      <Screen>
        <Text style={font(500, 15)}>This meal isn’t shared any more.</Text>
        <Button title="Back to meals" onPress={() => router.back()} />
      </Screen>
    );
  }

  const value = (k: MacroKey) => {
    const v = meal.macros[k];
    if (v === null) return '—';
    return k === 'calories' ? formatMacro(k, v).replace(/ kcal$/, '') : formatMacro(k, v);
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 56 + 32 + insets.bottom + 16 }}>
        <View style={[styles.photo, { backgroundColor: tileColour(meal.id) }]} accessibilityRole="image" accessibilityLabel={`${meal.name} photo`}>
          {photoUrl ? <Image source={{ uri: photoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to meals"
            testID="coach-meal-back"
            style={({ pressed }) => [styles.back, { top: insets.top + 4 }, pressed && { opacity: pressedOpacity }]}
          >
            <BackIcon />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <Text style={[font(700, 13), foodText.muted]}>{food.coachName ? `From ${food.coachName}` : 'From your coach'}</Text>
            <Text style={font(800, 28)} accessibilityRole="header">
              {meal.name}
            </Text>
          </View>
          <View style={styles.boxes}>
            {MACRO_KEYS.map((k) => (
              <View key={k} style={[styles.box, k === 'calories' ? styles.kcalBox : styles.otherBox]} testID={`coach-meal-${k}`}>
                <Text style={font(800, 18)}>{value(k)}</Text>
                <Text style={font(700, 11)}>{LABEL[k]}</Text>
              </View>
            ))}
          </View>
          {meal.ingredients.trim() ? (
            <View style={styles.section}>
              <Text style={foodText.overline} accessibilityRole="header">
                Ingredients
              </Text>
              <Text style={[font(500, 15), styles.ingredients]}>{meal.ingredients}</Text>
            </View>
          ) : null}
          {meal.howTo.trim() ? (
            <View style={styles.section}>
              <Text style={foodText.overline} accessibilityRole="header">
                How to make it
              </Text>
              <Text style={[font(500, 15), styles.howTo]}>{meal.howTo}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={[styles.sticky, { bottom: 32 + insets.bottom / 2 }]}>
        <Pressable
          onPress={() => router.push({ pathname: '/food/meal', params: { coachMealId: meal.id } })}
          accessibilityRole="button"
          accessibilityLabel="Log this meal"
          testID="coach-meal-log"
          style={({ pressed }) => [styles.log, inkShadow, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={font(800, 17)}>Log this meal</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  photo: { height: 240, borderBottomWidth: 2, borderBottomColor: palette.ink, overflow: 'hidden' },
  back: {
    position: 'absolute',
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.bg,
    borderWidth: 2,
    borderColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: 16, gap: 14 },
  titleBlock: { gap: 2 },
  boxes: { flexDirection: 'row', gap: 6 },
  box: { flex: 1, borderRadius: 14, padding: 8, alignItems: 'center' },
  kcalBox: { backgroundColor: palette.lime, borderWidth: 2, borderColor: palette.ink },
  otherBox: { backgroundColor: palette.surface },
  section: { gap: 6 },
  ingredients: { lineHeight: 24 },
  howTo: { lineHeight: 22 },
  sticky: { position: 'absolute', left: 16, right: 16 },
  log: { minHeight: 56, borderRadius: 18, borderWidth: 2, borderColor: palette.ink, backgroundColor: palette.lime, alignItems: 'center', justifyContent: 'center' },
});
