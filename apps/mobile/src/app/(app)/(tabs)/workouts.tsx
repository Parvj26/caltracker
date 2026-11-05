import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import { addDays, localToday, startOfWeek, type IsoDate } from '@caltracker/shared';
import { NameSheet } from '@/components/log/name-sheet';
import { ResumeBanner } from '@/components/log/resume-banner';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { workoutStatuses } from '@/lib/active-log-logic';
import { fetchLogsForDays, type LogForDay } from '@/lib/log-api';
import { START_BLOCKED, useActiveLog } from '@/lib/use-active-log';
import { formatDayMonth, groupByDay, weekdayShort, type WorkoutSummary } from '@/lib/workouts';
import { LOAD_FAILED, fetchWorkoutsBetween } from '@/lib/workouts-api';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

const START_FAILED = 'Couldn’t start a workout. Try again.';

export default function Workouts() {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  const { log: active, finished, startEmpty } = useActiveLog();
  const [weekStart, setWeekStart] = useState<IsoDate>(() => startOfWeek(localToday()));
  const [today, setToday] = useState<IsoDate>(() => localToday());
  const [items, setItems] = useState<{ weekStart: IsoDate; workouts: WorkoutSummary[]; logs: LogForDay[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [naming, setNaming] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const latest = useRef(0);

  const load = useCallback(async (from: IsoDate) => {
    const ticket = ++latest.current;
    setToday(localToday()); // The day may have changed since the screen opened.
    try {
      const to = addDays(from, 6);
      const [workouts, logs] = await Promise.all([
        fetchWorkoutsBetween(from, to),
        // The ✓ marks are a bonus: the week still shows when they can't be read.
        fetchLogsForDays(from, to).catch(() => [] as LogForDay[]),
      ]);
      if (ticket !== latest.current) return;
      setItems({ weekStart: from, workouts, logs });
      setError(null);
    } catch {
      if (ticket !== latest.current) return;
      setError(LOAD_FAILED);
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

  const shown = items?.weekStart === weekStart ? items : null;
  const days = groupByDay(shown?.workouts ?? [], weekStart);
  const loading = shown === null && !error;
  // Matched by the planned workout (its scheduled day), plus what this phone has just finished.
  const statuses = useMemo(() => workoutStatuses(shown?.logs ?? [], active, finished), [shown, active, finished]);
  const inProgress = active?.status === 'in_progress' ? active : null;

  const openLog = (id: string) => router.push({ pathname: '/log/[id]', params: { id } });

  function logUnplanned() {
    if (inProgress) {
      // Only one workout at a time: carry on with the one already going.
      Alert.alert(`${inProgress.name} is still going`, 'Finish or discard it before starting another workout.', [
        { text: 'Cancel', style: 'cancel' },
        { text: `Resume ${inProgress.name}`, onPress: () => openLog(inProgress.id) },
      ]);
      return;
    }
    setNaming(true);
  }

  async function startUnplanned(name: string) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const log = await startEmpty(name);
      setNaming(false);
      openLog(log.id);
    } catch (e) {
      Alert.alert(e instanceof Error && e.message === START_BLOCKED ? START_BLOCKED : START_FAILED);
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={() => void refresh()}>
      <Text style={text('screenTitle')} accessibilityRole="header">
        Workouts
      </Text>

      {inProgress ? <ResumeBanner name={inProgress.name} onPress={() => openLog(inProgress.id)} /> : null}

      <Button variant="secondary" title="Log a workout" testID="log-unplanned" onPress={logUnplanned} />

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
              testID={isToday ? 'today-row' : `day-${day.date}`}
              style={[styles.day, { gap: space[3], paddingVertical: space[2] }, i > 0 && styles.dayDivider]}
            >
              <View style={[styles.dayLabel, { gap: space[1] }]}>
                <Text style={text('caption')}>{weekdayShort(day.date)}</Text>
                <View
                  testID={isToday ? 'today-chip' : undefined}
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
                  day.items.map((w) => (
                    <WorkoutRow key={w.id} workout={w} done={statuses[w.id]?.kind === 'done'} />
                  ))
                )}
              </View>
            </View>
          );
        })}
      </Card>

      <NameSheet
        visible={naming}
        busy={starting}
        onStart={(name) => void startUnplanned(name)}
        onClose={() => setNaming(false)}
      />
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

function WorkoutRow({ workout, done }: { workout: WorkoutSummary; done: boolean }) {
  const { text, space, radius } = useTheme();
  const router = useRouter();
  return (
    <Pressable
      testID={`workout-row-${workout.id}`}
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
      {done ? (
        <Text testID={`done-mark-${workout.id}`} style={text('sectionHeading')} accessibilityLabel="Done">
          ✓
        </Text>
      ) : null}
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
  pressed: { opacity: pressedOpacity },
  day: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  dayDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  // Wide enough for a date chip and "Today"; at large text sizes the workouts wrap below instead of squeezing.
  dayLabel: { minWidth: tapTarget.min * 2, minHeight: tapTarget.min, justifyContent: 'center' },
  dateChip: { alignSelf: 'flex-start' },
  // Lime marks today; the word "Today" says it too, so colour is never the only signal.
  dateChipToday: { backgroundColor: palette.lime },
  dayItems: { flex: 1, minWidth: tapTarget.min * 4, justifyContent: 'center', minHeight: tapTarget.min },
  rest: { color: palette.inkMuted },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: tapTarget.min,
    backgroundColor: palette.surface,
  },
  flex: { flex: 1 },
});
