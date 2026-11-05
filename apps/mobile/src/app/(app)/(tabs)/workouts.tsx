import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { addDays, localToday, startOfWeek, type IsoDate } from '@caltracker/shared';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { formatDayMonth, groupByDay, weekdayShort, type WorkoutSummary } from '@/lib/workouts';
import { fetchWorkoutsBetween } from '@/lib/workouts-api';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

export default function Workouts() {
  const { text, space, radius } = useTheme();
  const [weekStart, setWeekStart] = useState<IsoDate>(() => startOfWeek(localToday()));
  const [today, setToday] = useState<IsoDate>(() => localToday());
  const [items, setItems] = useState<{ weekStart: IsoDate; workouts: WorkoutSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async (from: IsoDate) => {
    const ticket = ++latest.current;
    setToday(localToday()); // The day may have changed since the screen opened.
    try {
      const workouts = await fetchWorkoutsBetween(from, addDays(from, 6));
      if (ticket !== latest.current) return;
      setItems({ weekStart: from, workouts });
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(e instanceof Error ? e.message : 'Could not load your workouts. Try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(weekStart);
    }, [load, weekStart]),
  );

  async function refresh() {
    setRefreshing(true);
    await load(weekStart);
    setRefreshing(false);
  }

  const days = groupByDay(items?.weekStart === weekStart ? items.workouts : [], weekStart);
  const loading = items?.weekStart !== weekStart && !error;

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={() => void refresh()}>
      <Text style={text('screenTitle')} accessibilityRole="header">
        Workouts
      </Text>

      <View style={[styles.weekHeader, { gap: space[2] }]}>
        <WeekArrow label="Previous week" glyph="‹" onPress={() => setWeekStart((w) => addDays(w, -7))} />
        <Text style={[text('sectionHeading'), styles.weekTitle]} accessibilityRole="header">
          {`Week of ${formatDayMonth(weekStart)}`}
        </Text>
        <WeekArrow label="Next week" glyph="›" onPress={() => setWeekStart((w) => addDays(w, 7))} />
      </View>

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void refresh()} busy={refreshing} />
        </Card>
      ) : null}

      {loading ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

      <Card style={{ gap: space[2] }}>
        {days.map((day, i) => {
          const isToday = day.date === today;
          return (
            <View
              key={day.date}
              style={[styles.day, { gap: space[3], paddingVertical: space[2] }, i > 0 && styles.dayDivider]}
            >
              <View style={[styles.dayLabel, { gap: space[1] }]}>
                <Text style={text('caption')}>{weekdayShort(day.date)}</Text>
                <View
                  style={[
                    styles.dateChip,
                    { borderRadius: radius.pill, paddingHorizontal: space[2] },
                    isToday && styles.dateChipToday,
                  ]}
                >
                  <Text style={text('sectionHeading')}>{formatDayMonth(day.date)}</Text>
                </View>
                {isToday ? <Text style={text('sectionHeading')}>Today</Text> : null}
              </View>
              <View style={[styles.dayItems, { gap: space[1] }]}>
                {day.items.length === 0 ? (
                  <Text style={[text('body'), styles.rest]}>Rest</Text>
                ) : (
                  day.items.map((w) => <WorkoutRow key={w.id} workout={w} />)
                )}
              </View>
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

function WeekArrow({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  const { text, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={label === 'Next week' ? 'next-week' : 'previous-week'}
      style={({ pressed }) => [styles.arrow, { borderRadius: radius.pill }, pressed && styles.pressed]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

function WorkoutRow({ workout }: { workout: WorkoutSummary }) {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/workout/[id]', params: { id: workout.id } })}
      accessibilityRole="button"
      accessibilityHint="Opens the workout"
      style={({ pressed }) => [
        styles.workoutRow,
        { borderRadius: radius.input, paddingHorizontal: space[3], paddingVertical: space[2], gap: space[2] },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[text('sectionHeading'), styles.flex]}>{workout.name}</Text>
      <Text style={text('sectionHeading')} accessibilityElementsHidden importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  weekHeader: { flexDirection: 'row', alignItems: 'center' },
  weekTitle: { flex: 1, textAlign: 'center' },
  arrow: {
    minWidth: tapTarget.min,
    minHeight: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  pressed: { opacity: 0.75 },
  day: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  dayDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  dayLabel: { minWidth: 84, minHeight: tapTarget.min, justifyContent: 'center' },
  dateChip: { alignSelf: 'flex-start' },
  // Lime marks today; the word "Today" says it too, so colour is never the only signal.
  dateChipToday: { backgroundColor: palette.lime },
  dayItems: { flex: 1, minWidth: 160, justifyContent: 'center', minHeight: tapTarget.min },
  rest: { color: palette.inkMuted },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tapTarget.min,
    backgroundColor: palette.surface,
  },
  flex: { flex: 1 },
});
