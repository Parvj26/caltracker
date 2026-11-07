import { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import { dailyTotals, localToday, todayFoodSummary } from '@caltracker/shared';
import { useFood } from '@/lib/use-food';
import { useTheme } from '@/theme/use-theme';

/** Today's calories and protein against the coach's targets, for the Today goal card's food slot. */
export function TodayFood({ refreshKey }: { refreshKey: number }) {
  const { text, space } = useTheme();
  const food = useFood();
  const today = localToday();
  const loadDay = food?.loadDay;
  useEffect(() => {
    void loadDay?.(today);
  }, [loadDay, today, refreshKey]);
  const meals = food?.mealsOn(today);
  const summary = useMemo(() => (meals ? todayFoodSummary(dailyTotals(meals.map((m) => m.macros)), food?.targets ?? null) : null), [meals, food?.targets]);
  if (!summary) return null;
  return (
    <View style={{ gap: space[1] }} testID="today-food" accessible accessibilityLabel={`Food today: ${summary.calories}, ${summary.protein}`}>
      <Text style={text('caption')}>Food today</Text>
      <Text style={text('sectionHeading')}>
        {summary.calories} · {summary.protein}
      </Text>
    </View>
  );
}
