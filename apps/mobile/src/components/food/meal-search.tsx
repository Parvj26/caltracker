import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mealSearchMeta, searchMeals, type IsoDate, type MealSearchItem } from '@caltracker/shared';
import { palette, pressedOpacity } from '@/theme/theme';
import { FoodInput } from './food-input';
import { font, foodText } from './food-type';
import { SearchIcon } from './icons';

/**
 * "Search your meals": the client's own meals and the coach's, typo-tolerant. Nothing is listed until something is
 * typed; up to 8 results. Use fills the form below.
 */
export function MealSearch({
  items,
  today,
  coachName,
  onUse,
}: {
  items: MealSearchItem[];
  today: IsoDate;
  coachName: string | null;
  onUse: (item: MealSearchItem) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchMeals(items, query), [items, query]);
  const tag = coachName ? `From ${coachName}` : 'From your coach';
  return (
    <View style={styles.box}>
      <View style={styles.field}>
        <SearchIcon />
        <FoodInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your meals"
          accessibilityLabel="Search your meals"
          testID="meal-search"
          autoCorrect={false}
          returnKeyType="search"
          wrapStyle={styles.flex}
          style={[font(500, 16), styles.input]}
        />
      </View>
      {query.trim() !== '' && results.length === 0 ? (
        <Text style={[font(500, 13), foodText.muted, styles.none]} testID="meal-search-empty">
          No meals match. Fill it in below.
        </Text>
      ) : null}
      {results.map((r) => {
        const meta = mealSearchMeta(r, today);
        return (
          <Pressable
            key={r.key}
            onPress={() => {
              setQuery('');
              onUse(r);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Use ${r.name}${r.source === 'coach' ? `, ${tag}` : ''}, ${meta}`}
            testID={`meal-use-${r.name}`}
            style={({ pressed }) => [styles.result, pressed && { opacity: pressedOpacity }]}
          >
            <View style={styles.flex}>
              <View style={styles.nameRow}>
                <Text style={font(800, 15)}>{r.name}</Text>
                {r.source === 'coach' ? (
                  <View style={styles.tag}>
                    <Text style={font(800, 11)}>{tag}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[font(500, 12), foodText.muted]}>{meta}</Text>
            </View>
            <Text style={font(800, 13)}>Use</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6, padding: 12, borderRadius: 18, backgroundColor: palette.celebrateBg, borderWidth: 2, borderColor: palette.ink },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: palette.bg,
    borderWidth: 1.5,
    borderColor: palette.ink,
  },
  flex: { flex: 1 },
  input: { minHeight: 44 },
  none: { paddingHorizontal: 4 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: palette.bg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tag: { backgroundColor: palette.drop, borderWidth: 1.5, borderColor: palette.ink, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 },
});
