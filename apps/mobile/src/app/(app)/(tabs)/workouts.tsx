import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import { addDays, canStartSessionOn, formatLogDuration, localToday, startOfWeek, type IsoDate } from '@caltracker/shared';
import { NameSheet } from '@/components/log/name-sheet';
import { ResumeBanner } from '@/components/log/resume-banner';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { workoutStatuses, type WorkoutStatus } from '@/lib/active-log-logic';
import { fetchLogsForDays, type LogForDay } from '@/lib/log-api';
import { logsForWeek } from '@/lib/plan-cache';
import { useActiveLog } from '@/lib/use-active-log';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { useStartWorkout } from '@/lib/use-start-workout';
import { weekdayShort } from '@/lib/workouts';
import { LOAD_FAILED, cachePlan, fetchComingUp, fetchPlannedBetween, readCachedPlan } from '@/lib/workouts-api';
import {
  firstSelectedDay,
  muscleTags,
  planMeta,
  planTotals,
  selectedHeading,
  weekStrip,
  weekTitle,
  type PlannedWorkout,
  type StripDay,
} from '@/lib/workouts-plan';
import { palette, pressedOpacity, radius, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type WeekData = {
  weekStart: IsoDate;
  week: PlannedWorkout[];
  logs: LogForDay[];
  comingUp: PlannedWorkout[];
  /** Shown from the copy saved on the phone (no signal). */
  offline: boolean;
};

/** Everything the tab shows for one week: its plan, its logs (for ✓) and the next workouts after today. */
async function loadWeek(from: IsoDate, today: IsoDate): Promise<WeekData> {
  const to = addDays(from, 6);
  const thisWeek = from === startOfWeek(today);
  try {
    const [week, freshLogs, comingUp] = await Promise.all([
      fetchPlannedBetween(from, to),
      // The ✓ marks must survive a failed read: then the logs saved with the plan are used (null = not read).
      fetchLogsForDays(from, to).catch(() => null),
      fetchComingUp(today),
    ]);
    const cached = freshLogs === null ? await readCachedPlan() : null;
    const logs = logsForWeek(freshLogs, cached, from);
    if (thisWeek) void cachePlan({ weekStart: from, week, comingUp, logs });
    return { weekStart: from, week, logs, comingUp, offline: false };
  } catch (e) {
    const cached = await readCachedPlan();
    if (!cached || cached.weekStart !== from) throw e;
    // The saved logs keep Done ✓ and Resume, so a finished workout is never offered Start again.
    return {
      weekStart: from,
      week: cached.week,
      logs: cached.logs,
      comingUp: cached.comingUp.filter((w) => w.scheduledOn > today),
      offline: true,
    };
  }
}

export default function Workouts() {
  const { text, space } = useTheme();
  const router = useRouter();
  const { log: active, finished, pending } = useActiveLog();
  const { starting, inProgress, isFree, openLog, openSummary, startPlanned, startUnplanned } = useStartWorkout();
  const [today, setToday] = useState<IsoDate>(() => localToday());
  const [weekStart, setWeekStart] = useState<IsoDate>(() => startOfWeek(localToday()));
  // Null: the week's default day (today in this week, else its first workout day).
  const [picked, setPicked] = useState<IsoDate | null>(null);
  const [data, setData] = useState<WeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [naming, setNaming] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async (from: IsoDate) => {
    const ticket = ++latest.current;
    const now = localToday(); // The day may have changed since the screen opened.
    setToday(now);
    try {
      const next = await loadWeek(from, now);
      if (ticket !== latest.current) return;
      setData(next);
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

  function changeWeek(by: number) {
    setPicked(null);
    setWeekStart((w) => addDays(w, by * 7));
  }

  const shown = data?.weekStart === weekStart ? data : null;
  const week = useMemo(() => shown?.week ?? [], [shown]);
  const statuses = useMemo(() => workoutStatuses(shown?.logs ?? [], active, finished, pending), [shown, active, finished, pending]);
  const strip = useMemo(
    () =>
      weekStrip(
        weekStart,
        today,
        picked ?? firstSelectedDay(weekStart, today, week),
        week.map((w) => ({ id: w.doc.id, scheduledOn: w.scheduledOn })),
        statuses,
      ),
    [weekStart, today, picked, week, statuses],
  );
  const selected = strip.find((d) => d.selected)?.date ?? weekStart;
  const dayWorkouts = week.filter((w) => w.scheduledOn === selected);
  const dayExerciseIds = useMemo(
    () => dayWorkouts.flatMap((w) => w.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId))),
    [dayWorkouts],
  );
  const details = useExerciseDetails(dayExerciseIds);

  const openPreview = (id: string) => router.push({ pathname: '/plan/[id]', params: { id } });

  async function startNamed(name: string) {
    if (await startUnplanned(name)) setNaming(false);
  }

  return (
    <Screen inTabs refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={[styles.row, { gap: space[2] }]}>
        <Text style={[text('screenTitle'), styles.flex]} accessibilityRole="header">
          Workouts
        </Text>
        <HistoryButton onPress={() => router.push('/history')} />
      </View>

      {inProgress ? <ResumeBanner name={inProgress.name} onPress={() => openLog(inProgress.id)} /> : null}

      <View style={{ gap: space[2.5] }}>
        <View style={styles.row}>
          <WeekArrow label="Previous week" glyph="‹" onPress={() => changeWeek(-1)} />
          <Text style={[text('sectionHeading'), styles.weekTitle]} accessibilityRole="header">
            {weekTitle(weekStart, today)}
          </Text>
          <WeekArrow label="Next week" glyph="›" onPress={() => changeWeek(1)} />
        </View>
        <View style={[styles.row, { gap: space[1] }]}>
          {strip.map((d) => (
            <DayButton key={d.date} day={d} onPress={() => setPicked(d.date)} />
          ))}
        </View>
      </View>

      {shown?.offline ? <Text style={text('caption')}>No connection. This is the plan saved on your phone.</Text> : null}

      {error ? (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void refresh()} busy={refreshing} />
        </Card>
      ) : null}

      {shown === null && !error ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}

      {shown !== null && dayWorkouts.length === 0 ? (
        <View testID="selected-rest" style={[styles.dayCard, styles.restCard, { padding: space[4], gap: space[1] }]}>
          <Text style={[text('caption'), styles.overline]}>{selectedHeading(selected, today)}</Text>
          <Text style={text('screenTitle')}>Rest day</Text>
          <Text style={[text('body'), styles.muted]}>Nothing planned for this day.</Text>
        </View>
      ) : null}

      {dayWorkouts.map((w) => (
        <DayCard
          key={w.doc.id}
          workout={w}
          heading={selectedHeading(selected, today)}
          tags={muscleTags(
            w.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)),
            details,
          )}
          status={statuses[w.doc.id] ?? null}
          canStart={canStartSessionOn(w.scheduledOn, today)}
          starting={starting === w.doc.id}
          onStart={() => void startPlanned(w.doc)}
          onResume={openLog}
          onView={openSummary}
          onPreview={() => openPreview(w.doc.id)}
        />
      ))}

      {shown && shown.comingUp.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text style={text('sectionHeading')} accessibilityRole="header">
            Coming up
          </Text>
          {shown.comingUp.map((w) => (
            <ComingUpRow key={w.doc.id} workout={w} onPress={() => openPreview(w.doc.id)} />
          ))}
        </View>
      ) : null}

      <Button
        variant="secondary"
        title="+ Log a workout not on the plan"
        testID="log-unplanned"
        onPress={() => isFree() && setNaming(true)}
      />

      <NameSheet
        visible={naming}
        busy={starting === 'unplanned'}
        onStart={(name) => void startNamed(name)}
        onClose={() => setNaming(false)}
      />
    </Screen>
  );
}

function HistoryButton({ onPress }: { onPress: () => void }) {
  const { text, space, radius } = useTheme();
  return (
    <Pressable
      testID="open-history"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="History"
      accessibilityHint="Shows your finished workouts"
      style={({ pressed }) => [
        styles.historyButton,
        { borderRadius: radius.button, paddingHorizontal: space[3.5], gap: 6 },
        pressed && styles.pressed,
      ]}
    >
      <Text style={text('sectionHeading')} accessibilityElementsHidden importantForAccessibility="no">
        ↺
      </Text>
      <Text style={text('sectionHeading')}>History</Text>
    </Pressable>
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

/** One day of the strip: today filled ink, workout days outlined with a dot (✓ once done), rest days light. */
function DayButton({ day, onPress }: { day: StripDay; onPress: () => void }) {
  const { text, radius } = useTheme();
  const onInk = day.isToday ? styles.onInk : null;
  const mark = day.done ? '✓' : day.hasWorkout ? '●' : '';
  return (
    <Pressable
      testID={day.isToday ? 'today-chip' : `day-${day.date}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={day.label}
      accessibilityState={{ selected: day.selected }}
      style={({ pressed }) => [
        styles.day,
        { borderRadius: radius.input + 2, paddingVertical: 6 },
        day.hasWorkout ? styles.dayWorkout : styles.dayRest,
        day.selected && !day.isToday && styles.daySelected,
        day.isToday && styles.dayToday,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[text('caption'), styles.dayDow, !day.hasWorkout && !day.isToday && styles.muted, onInk]}>{day.dow}</Text>
      <Text style={[text('sectionHeading'), styles.dayNum, !day.hasWorkout && !day.isToday && styles.muted, onInk]}>
        {day.num}
      </Text>
      <Text testID={day.done ? `done-mark-${day.date}` : undefined} style={[text('caption'), styles.dayMark, onInk]}>
        {mark}
      </Text>
    </Pressable>
  );
}

function DayCard({
  workout,
  heading,
  tags,
  status,
  canStart,
  starting,
  onStart,
  onResume,
  onView,
  onPreview,
}: {
  workout: PlannedWorkout;
  heading: string;
  tags: string[];
  status: WorkoutStatus | null;
  /** Today's and earlier workouts can be started; later ones can only be previewed. */
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
  onResume: (logId: string) => void;
  onView: (logId: string) => void;
  onPreview: () => void;
}) {
  const { text, space, radius } = useTheme();
  const totals = planTotals(workout.doc);
  const pd = workout.programDay;
  return (
    <View testID={`day-card-${workout.doc.id}`} style={[styles.dayCard, { padding: space[4], gap: space[2.5] }]}>
      <View style={[styles.row, { gap: space[2] }]}>
        <Text style={[text('caption'), styles.overline, styles.flex]}>{heading}</Text>
        {pd ? (
          <View style={[styles.weekChip, { borderRadius: radius.pill, paddingHorizontal: space[2.5], paddingVertical: 3 }]}>
            <Text style={[text('caption'), styles.ink, styles.bold]}>{`Week ${pd.week} · Day ${pd.day}`}</Text>
          </View>
        ) : null}
      </View>
      <Text style={text('screenTitle')}>{workout.doc.name}</Text>
      <Text style={text('body')}>{planMeta(totals, true)}</Text>
      {tags.length > 0 ? (
        <View style={[styles.tags, { gap: 6 }]} accessibilityLabel={`Muscles: ${tags.join(', ')}`}>
          {tags.map((t) => (
            <View key={t} style={[styles.tag, { borderRadius: radius.pill, paddingHorizontal: space[2.5], paddingVertical: 5 }]}>
              <Text style={[text('caption'), styles.ink, styles.bold]}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {status?.kind === 'done' ? (
        <Text testID={`done-${workout.doc.id}`} style={text('sectionHeading')}>
          {`Done ✓ · ${formatLogDuration(status.durationS)}`}
        </Text>
      ) : null}
      <View style={[styles.row, { gap: space[2.5], marginTop: space[1] }]}>
        <View style={styles.flex}>
          {status?.kind === 'done' ? (
            <Button title="View summary" testID={`view-log-${workout.doc.id}`} onPress={() => onView(status.logId)} />
          ) : status?.kind === 'in_progress' ? (
            <Button title="Resume" testID={`start-${workout.doc.id}`} onPress={() => onResume(status.logId)} />
          ) : canStart ? (
            <Button title="Start workout" testID={`start-${workout.doc.id}`} onPress={onStart} busy={starting} />
          ) : (
            <Button variant="secondary" title="Preview" testID={`preview-${workout.doc.id}`} onPress={onPreview} />
          )}
        </View>
        {status?.kind === 'done' || status?.kind === 'in_progress' || canStart ? (
          <View>
            <Button variant="secondary" title="Preview" testID={`preview-${workout.doc.id}`} onPress={onPreview} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ComingUpRow({ workout, onPress }: { workout: PlannedWorkout; onPress: () => void }) {
  const { text, space, radius } = useTheme();
  const meta = planMeta(planTotals(workout.doc), false);
  const day = Number(workout.scheduledOn.slice(8, 10));
  return (
    <Pressable
      testID={`coming-up-${workout.doc.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${workout.doc.name}, ${weekdayShort(workout.scheduledOn)} ${day}, ${meta}`}
      accessibilityHint="Opens the preview"
      style={({ pressed }) => [
        styles.row,
        styles.comingUp,
        { borderRadius: radius.button, paddingHorizontal: space[3.5], paddingVertical: space[2], gap: space[3] },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.dateCol}>
        <Text style={[text('caption'), styles.bold]}>{weekdayShort(workout.scheduledOn)}</Text>
        <Text style={[text('sectionHeading'), styles.dayNum]}>{day}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={text('sectionHeading')}>{workout.doc.name}</Text>
        <Text style={text('caption')}>{meta}</Text>
      </View>
      <Text style={text('sectionHeading')}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  weekTitle: { flex: 1, textAlign: 'center' },
  pressed: { opacity: pressedOpacity },
  historyButton: {
    minHeight: tapTarget.min,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
  },
  arrow: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  day: {
    flex: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: borderWidth.card,
  },
  dayWorkout: { backgroundColor: palette.surface, borderColor: palette.ink },
  dayRest: { backgroundColor: palette.bg, borderColor: palette.border },
  daySelected: { backgroundColor: palette.lime, borderColor: palette.ink },
  dayToday: { backgroundColor: palette.ink, borderColor: palette.ink },
  dayDow: { fontWeight: '700', color: palette.ink },
  dayNum: { fontSize: 18, fontWeight: '800' },
  dayMark: { fontWeight: '800', color: palette.ink, minHeight: 16 },
  onInk: { color: white },
  muted: { color: palette.inkMuted },
  ink: { color: palette.ink },
  bold: { fontWeight: '700' },
  overline: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  dayCard: { borderWidth: borderWidth.card, borderColor: palette.ink, borderRadius: radius.card, backgroundColor: palette.bg },
  restCard: { borderColor: palette.border },
  weekChip: { backgroundColor: palette.lime, borderWidth: borderWidth.secondaryButton, borderColor: palette.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: { backgroundColor: palette.surface },
  comingUp: { minHeight: 60, borderWidth: borderWidth.card, borderColor: palette.border },
  dateCol: { width: tapTarget.min, alignItems: 'center' },
});
