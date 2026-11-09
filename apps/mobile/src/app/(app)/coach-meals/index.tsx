import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COACH_MEAL_CHIPS, filterCoachMeals, type CoachMealChip } from '@caltracker/shared';
import { CoachMealTile } from '@/components/food/coach-meal-tile';
import { FoodInput } from '@/components/food/food-input';
import { font, foodText } from '@/components/food/food-type';
import { BackIcon, SearchIcon } from '@/components/food/icons';
import { Screen } from '@/components/ui';
import { coachMealPhotoUrls } from '@/lib/coach-meals-api';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, white } from '@/theme/theme';

/**
 * Meals from <coach>: every meal the coach shares, searchable, with High protein / Under 500 kcal / Low carb chips
 * (all chosen chips must match). Tap one for the recipe and "Log this meal". Shows the last loaded list offline.
 */
export default function CoachMealsScreen() {
  const router = useRouter();
  const food = useFood();
  const [query, setQuery] = useState('');
  const [chips, setChips] = useState<ReadonlySet<CoachMealChip>>(new Set());
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = food?.loadCoachMeals;
  useFocusEffect(
    useCallback(() => {
      void load?.();
    }, [load]),
  );

  const all = useMemo(() => food?.coachMeals ?? [], [food?.coachMeals]);
  const shown = useMemo(() => filterCoachMeals(all, query, chips), [all, query, chips]);

  const missing = all.flatMap((m) => (m.photo && !urls[m.photo.thumbPath] ? [m.photo.thumbPath] : []));
  const missingKey = missing.join('|');
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    void coachMealPhotoUrls(missingKey.split('|')).then((u) => alive && setUrls((prev) => ({ ...prev, ...u })));
    return () => {
      alive = false;
    };
  }, [missingKey]);

  if (!food) return null;
  const who = food.coachName ?? 'your coach';
  const possessive = food.coachName ? `${food.coachName}'s` : "your coach's";

  function toggle(c: CoachMealChip) {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const rows: Array<typeof shown> = [];
  for (let i = 0; i < shown.length; i += 2) rows.push(shown.slice(i, i + 2));

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void food.loadCoachMeals().finally(() => setRefreshing(false));
      }}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to Coach"
          testID="coach-meals-back"
          style={({ pressed }) => [styles.back, pressed && { opacity: pressedOpacity }]}
        >
          <BackIcon />
        </Pressable>
        <View style={styles.flex}>
          <Text style={font(800, 24)} accessibilityRole="header">
            Meals from {who}
          </Text>
          <Text style={[font(500, 13), foodText.muted]} testID="coach-meals-count">
            {all.length === 1 ? '1 meal' : `${all.length} meals`} · tap one to log it
          </Text>
        </View>
      </View>

      <View style={styles.search}>
        <SearchIcon />
        <FoodInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${possessive} meals`}
          accessibilityLabel={`Search ${possessive} meals`}
          testID="coach-meals-search"
          autoCorrect={false}
          returnKeyType="search"
          wrapStyle={styles.flex}
          style={[font(500, 16), styles.input]}
        />
      </View>

      <View style={styles.chips} accessibilityLabel="Filters">
        {COACH_MEAL_CHIPS.map((c) => {
          const on = chips.has(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => toggle(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`coach-meals-chip-${c.id}`}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: pressedOpacity }]}
            >
              <Text style={[font(700, 14), on && styles.onInk]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {all.length === 0 ? (
        <Text style={[font(500, 15), foodText.muted]} testID="coach-meals-none">
          {food.coachName ? `${food.coachName} hasn't shared any meals yet.` : "Your coach hasn't shared any meals yet."}
        </Text>
      ) : shown.length === 0 ? (
        <Text style={[font(500, 15), foodText.muted]} testID="coach-meals-empty">
          No meals match. Try fewer filters.
        </Text>
      ) : (
        <View style={styles.grid}>
          {rows.map((row) => (
            <View key={row.map((m) => m.id).join('|')} style={styles.gridRow}>
              {row.map((m) => (
                <View key={m.id} style={styles.cell}>
                  <CoachMealTile
                    meal={m}
                    photoUrl={m.photo ? urls[m.photo.thumbPath] : undefined}
                    onPress={() => router.push({ pathname: '/coach-meals/[id]', params: { id: m.id } })}
                  />
                </View>
              ))}
              {row.length === 1 ? <View style={styles.cell} /> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1.5, borderColor: palette.ink },
  input: { minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: palette.ink, backgroundColor: palette.bg, justifyContent: 'center' },
  chipOn: { backgroundColor: palette.ink, borderWidth: 2 },
  onInk: { color: white },
  // Equal cells (the tile's border sat outside its flex share, so a lone tile came out wider than the spacer).
  cell: { flex: 1 },
  grid: { gap: 10 },
  gridRow: { flexDirection: 'row', gap: 10 },
});
