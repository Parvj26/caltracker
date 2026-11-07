import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, dailyTotals, foodDayLabel, localToday } from '@caltracker/shared';
import { LogMealSheet, type LogChoice } from '@/components/food/log-meal-sheet';
import { MacroBars } from '@/components/food/macro-bars';
import { MealRow } from '@/components/food/meal-row';
import { Button, Card, ErrorText, Screen, TextButton } from '@/components/ui';
import { mealPhotoUrls } from '@/lib/food-api';
import { clampDay } from '@/lib/food-logic';
import { PhotoError } from '@/lib/compress-photo';
import { photoParams, pickMealPhoto } from '@/lib/pick-meal-photo';
import { useFood } from '@/lib/use-food';
import { palette, pressedOpacity, radius, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

/**
 * Food: one day's totals against the coach's targets, the day's meals, and "Log a meal" (take a photo, choose one,
 * or type the macros). Works with no signal: meals are queued on the phone and saved when back online.
 */
export default function FoodScreen() {
  const { text } = useTheme();
  const router = useRouter();
  const food = useFood();
  const [today, setToday] = useState(() => localToday());
  const [day, setDay] = useState(today);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const loadDay = food?.loadDay;
  useFocusEffect(
    useCallback(() => {
      // A tab left open overnight moves on to the new today.
      const now = localToday();
      if (now === today) return;
      setToday(now);
      if (day === today) setDay(now);
    }, [today, day]),
  );
  useFocusEffect(
    useCallback(() => {
      void loadDay?.(day);
    }, [loadDay, day]),
  );

  const meals = useMemo(() => food?.mealsOn(day) ?? [], [food, day]);
  const totals = useMemo(() => dailyTotals(meals.map((m) => m.macros)), [meals]);

  // Links for the stored photos not yet linked.
  const missing = meals.flatMap((m) => (m.photo && !m.localPhoto && !urls[m.photo.thumbPath] ? [m.photo.thumbPath, m.photo.path] : []));
  const missingKey = missing.join('|');
  useEffect(() => {
    if (!missingKey) return;
    let alive = true;
    void mealPhotoUrls(missingKey.split('|')).then((u) => alive && setUrls((prev) => ({ ...prev, ...u })));
    return () => {
      alive = false;
    };
  }, [missingKey]);

  async function pick(choice: LogChoice) {
    setSheet(false);
    setError(null);
    if (choice === 'macros') {
      router.push({ pathname: '/food/meal', params: { day } });
      return;
    }
    setBusy(true);
    try {
      const picked = await pickMealPhoto(choice);
      if (picked) router.push({ pathname: '/food/meal', params: { day, ...photoParams(picked) } });
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : "Couldn't prepare that photo. Please try another.");
    } finally {
      setBusy(false);
    }
  }

  if (!food) return null;
  const status = food.statusOf(day);
  const atToday = day >= today;

  return (
    <Screen
      inTabs
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void food.loadDay(day).finally(() => setRefreshing(false));
      }}
    >
      <Text style={text('screenTitle')} accessibilityRole="header">
        Food
      </Text>

      <View style={styles.switcher}>
        <DayArrow label="Previous day" glyph="‹" testID="food-prev-day" onPress={() => setDay((d) => addDays(d, -1))} />
        <Text style={[text('sectionHeading'), styles.dayLabel]} accessibilityRole="header" testID="food-day">
          {foodDayLabel(day, today)}
        </Text>
        <DayArrow label="Next day" glyph="›" testID="food-next-day" disabled={atToday} onPress={() => setDay((d) => clampDay(addDays(d, 1), today))} />
      </View>
      {status === 'offline' ? <Text style={text('caption')}>Showing your saved meals. They update when you’re online.</Text> : null}

      <Card>
        <MacroBars totals={totals} targets={food.targets} />
      </Card>

      <Button title="Log a meal" testID="food-log-meal" busy={busy} onPress={() => setSheet(true)} />
      {error ? <ErrorText testID="food-error">{error}</ErrorText> : null}

      {food.failed.map((op) => (
        <View key={op.opId} style={styles.failedBox} testID="food-failed">
          <Text style={text('body')}>
            {op.kind === 'save' ? `${op.meal.name ?? 'A meal'} didn’t save.` : 'A meal couldn’t be deleted.'} {op.error ?? ''}
          </Text>
          <View style={styles.actions}>
            <TextButton title="Retry" testID="food-retry" onPress={() => food.retry(op.opId)} />
            <TextButton title="Discard" testID="food-discard" onPress={() => food.discard(op.opId)} />
          </View>
        </View>
      ))}

      <View>
        {meals.length === 0 ? (
          <Text style={text('body')} testID="food-empty">
            {status === 'loading' ? 'Loading…' : day === today ? 'No meals yet today.' : 'No meals logged this day.'}
          </Text>
        ) : (
          meals.map((m) => (
            <MealRow key={m.id} meal={m} urls={urls} onPress={() => router.push({ pathname: '/food/meal', params: { id: m.id, day: m.eatenOn } })} />
          ))
        )}
      </View>

      <LogMealSheet visible={sheet} onPick={(c) => void pick(c)} onClose={() => setSheet(false)} />
    </Screen>
  );
}

function DayArrow({ label, glyph, onPress, disabled = false, testID }: { label: string; glyph: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const { text } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      hitSlop={space[2]}
      style={({ pressed }) => [styles.arrow, disabled && styles.disabled, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  switcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayLabel: { flex: 1, textAlign: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: palette.surface },
  disabled: { opacity: 0.3 },
  failedBox: { gap: space[2], padding: space[3], borderRadius: radius.input, backgroundColor: palette.drop },
  actions: { flexDirection: 'row', gap: space[4] },
});
