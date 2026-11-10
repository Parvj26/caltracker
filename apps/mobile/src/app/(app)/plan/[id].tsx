import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  canStartSessionOn,
  localToday,
  sectionRuns,
  type Units,
  type WorkoutBlockDoc,
  type WorkoutExerciseDoc,
} from '@caltracker/shared';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExerciseThumb } from '@/components/log/exercise-thumb';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { workoutStatuses } from '@/lib/active-log-logic';
import type { ExerciseDetail } from '@/lib/exercise-detail';
import {
  fetchLastResults,
  fetchLogsForDays,
  readCachedDetail,
  readCachedTodayLogs,
  type LastResults,
  type LogForDay,
} from '@/lib/log-api';
import { logsOfWorkout } from '@/lib/plan-cache';
import { useActiveLog } from '@/lib/use-active-log';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { useStartWorkout } from '@/lib/use-start-workout';
import { useUnits } from '@/lib/use-units';
import { formatDayLabel } from '@/lib/workouts';
import { fetchPlannedWorkout, readCachedPlan } from '@/lib/workouts-api';
import {
  coachFirstName,
  exercisePlanLine,
  lastTimeLine,
  planTotals,
  previewSubtitle,
  type PlannedWorkout,
} from '@/lib/workouts-plan';
import { palette, pressedOpacity } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';
import { ChevronIcon } from '@/components/ui/icons';

const LOAD_FAILED = 'Couldn’t load this workout. Check your connection and try again.';

type Loaded = { kind: 'loading' } | { kind: 'missing' } | { kind: 'failed' } | { kind: 'ok'; workout: PlannedWorkout };

/** The server's copy, else the one the Workouts tab or Today saved on the phone (no signal). */
async function loadWorkout(id: string): Promise<PlannedWorkout | null> {
  try {
    return await fetchPlannedWorkout(id);
  } catch (e) {
    const plan = await readCachedPlan();
    const hit = plan ? [...plan.week, ...plan.comingUp].find((w) => w.doc.id === id) : undefined;
    if (hit) return hit;
    const today = await readCachedDetail(localToday(), id);
    if (today) return { doc: today.doc, scheduledOn: today.scheduledOn, programName: null, programDay: null };
    throw e;
  }
}

/**
 * The workout's logs as last saved (the Workouts tab's week, else Today's), so without signal a finished or
 * coach-logged workout still reads Done or in progress and Start is not offered twice.
 */
async function savedLogs(workoutId: string): Promise<LogForDay[]> {
  const fromPlan = logsOfWorkout(await readCachedPlan(), workoutId);
  if (fromPlan.length > 0) return fromPlan;
  return (await readCachedTodayLogs(localToday())).filter((l) => l.workoutId === workoutId);
}

/** Tap a workout on the Workouts tab: what it holds, the coach's note, last time per exercise, and Start. */
export default function PlanPreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const units = useUnits() ?? 'lb';
  const coach = useCoachProfile();
  const { log: active, finished, pending } = useActiveLog();
  const { starting, openLog, openSummary, startPlanned } = useStartWorkout();
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [logs, setLogs] = useState<LogForDay[]>([]);
  // Null until read, or when history can't be read (then no "Last time" lines at all).
  const [last, setLast] = useState<LastResults | null>(null);
  const [infoFor, setInfoFor] = useState<WorkoutExerciseDoc | null>(null);

  const load = useCallback(async () => {
    try {
      const w = await loadWorkout(id ?? '');
      if (!w) {
        setLoaded({ kind: 'missing' });
        return;
      }
      setLoaded({ kind: 'ok', workout: w });
      const ids = w.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId));
      // Last time only decorates the screen; the logs fall back to the saved copy so Start isn't offered twice.
      void fetchLastResults(ids).then(setLast, () => setLast(null));
      void fetchLogsForDays(w.scheduledOn, w.scheduledOn)
        .catch(() => savedLogs(w.doc.id))
        .then(setLogs, () => undefined);
    } catch {
      setLoaded((l) => (l.kind === 'ok' ? l : { kind: 'failed' }));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const workout = loaded.kind === 'ok' ? loaded.workout : null;
  const exerciseIds = useMemo(
    () => workout?.doc.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)) ?? [],
    [workout],
  );
  const details = useExerciseDetails(exerciseIds);
  const status = workout ? (workoutStatuses(logs, active, finished, pending)[workout.doc.id] ?? null) : null;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/workouts'));

  const footer = workout ? (
    status?.kind === 'done' ? (
      <Button title="View summary" testID="plan-view-log" onPress={() => openSummary(status.logId)} />
    ) : status?.kind === 'in_progress' ? (
      <Button title="Resume" testID="plan-start" onPress={() => openLog(status.logId)} />
    ) : canStartSessionOn(workout.scheduledOn, localToday()) ? (
      <Button
        title="Start workout"
        testID="plan-start"
        onPress={() => void startPlanned(workout.doc)}
        busy={starting === workout.doc.id}
      />
    ) : (
      <Text style={[text('body'), styles.centre]}>{`You can start this on ${formatDayLabel(workout.scheduledOn)}.`}</Text>
    )
  ) : null;

  return (
    <Screen footer={footer}>
      <Pressable
        testID="back"
        onPress={back}
        accessibilityRole="button"
        accessibilityLabel="Back to Workouts"
        style={({ pressed }) => [styles.back, { borderRadius: radius.pill }, pressed && styles.pressed]}
      >
        <ChevronIcon direction="left" />
      </Pressable>

      {loaded.kind === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {loaded.kind === 'failed' ? (
        <Card>
          <ErrorText>{LOAD_FAILED}</ErrorText>
          <Button variant="secondary" title="Try again" onPress={() => void load()} />
        </Card>
      ) : null}
      {loaded.kind === 'missing' ? (
        <Card>
          <Text style={text('sectionHeading')}>This workout isn't on your calendar any more.</Text>
        </Card>
      ) : null}

      {workout ? (
        <>
          <View style={{ gap: space[1] }}>
            <Text style={[text('body'), styles.bold]}>
              {previewSubtitle(workout.scheduledOn, workout.programName, workout.programDay)}
            </Text>
            <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header">
              {workout.doc.name}
            </Text>
          </View>

          <Stats totals={planTotals(workout.doc)} />

          {workout.doc.notes ? (
            <View testID="plan-note" style={[styles.note, { borderRadius: radius.button, padding: space[3], gap: space[1] }]}>
              <Text style={[text('caption'), styles.noteLabel]}>
                {`Note from ${coachFirstName(coach?.name) ?? 'your coach'}`}
              </Text>
              <Text style={[text('body'), styles.ink, styles.noteBody]}>{workout.doc.notes}</Text>
            </View>
          ) : null}

          {sectionRuns(workout.doc.blocks, workout.doc.sections).map((run, r) => (
            <Fragment key={run.section?.id ?? `none-${r}`}>
              {run.section ? (
                <Text testID={`plan-section-${r}`} style={text('sectionHeading')} accessibilityRole="header">
                  {run.section.name}
                </Text>
              ) : null}
              {run.blockIndexes.map((i) => {
                const block = workout.doc.blocks[i];
                return block ? (
                  <BlockRows
                    key={block.id}
                    block={block}
                    units={units}
                    last={last}
                    details={details}
                    onInfo={setInfoFor}
                  />
                ) : null;
              })}
            </Fragment>
          ))}
        </>
      ) : null}

      <ExerciseInfoSheet
        name={infoFor?.exerciseName ?? null}
        detail={infoFor ? details[infoFor.exerciseId] : undefined}
        onClose={() => setInfoFor(null)}
      />
    </Screen>
  );
}

function Stats({ totals }: { totals: { exercises: number; sets: number; minutes: number } }) {
  const { text, space, radius } = useTheme();
  const boxes = [
    { value: String(totals.exercises), label: totals.exercises === 1 ? 'exercise' : 'exercises' },
    { value: String(totals.sets), label: totals.sets === 1 ? 'set' : 'sets' },
    { value: `~${totals.minutes}`, label: 'minutes', spoken: `about ${totals.minutes} minutes` },
  ];
  return (
    <View style={[styles.row, { gap: space[2] }]}>
      {boxes.map((b) => (
        <View
          key={b.label}
          accessible
          accessibilityLabel={b.spoken ?? `${b.value} ${b.label}`}
          style={[styles.stat, { borderRadius: radius.button, padding: space[2.5] }]}
        >
          <Text style={[text('bigNumber'), styles.statValue]}>{b.value}</Text>
          <Text style={[text('caption'), styles.ink, styles.bold]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A block's exercises as rows; a pick-one group and a superset say so above their rows. */
function BlockRows({
  block,
  units,
  last,
  details,
  onInfo,
}: {
  block: WorkoutBlockDoc;
  units: Units;
  last: LastResults | null;
  details: Record<string, ExerciseDetail>;
  onInfo: (e: WorkoutExerciseDoc) => void;
}) {
  const { text, space } = useTheme();
  const label = block.kind === 'choice' ? 'Pick one' : block.kind === 'superset' ? 'Superset' : null;
  return (
    <View style={{ gap: space[2] }}>
      {label ? (
        <Text testID={block.kind === 'choice' ? `plan-pick-one-${block.id}` : undefined} style={[text('caption'), styles.overline]}>
          {label}
        </Text>
      ) : null}
      {block.exercises.map((e) => (
        <ExerciseRow key={e.id} exercise={e} units={units} last={last} detail={details[e.exerciseId]} onInfo={() => onInfo(e)} />
      ))}
    </View>
  );
}

function ExerciseRow({
  exercise,
  units,
  last,
  detail,
  onInfo,
}: {
  exercise: WorkoutExerciseDoc;
  units: Units;
  last: LastResults | null;
  detail: ExerciseDetail | undefined;
  onInfo: () => void;
}) {
  const { text, space, radius } = useTheme();
  const plan = exercisePlanLine(exercise, units);
  const lastLine = lastTimeLine(exercise, last, units);
  return (
    <Pressable
      testID={`plan-exercise-${exercise.id}`}
      onPress={onInfo}
      accessibilityRole="button"
      accessibilityLabel={[exercise.exerciseName, plan, lastLine].filter(Boolean).join(', ')}
      accessibilityHint="Opens exercise info"
      style={({ pressed }) => [
        styles.row,
        styles.exercise,
        { borderRadius: radius.button, paddingHorizontal: space[3], paddingVertical: space[2.5], gap: space[3] },
        pressed && styles.pressed,
      ]}
    >
      <ExerciseThumb name={exercise.exerciseName} detail={detail} testID={`plan-thumb-${exercise.id}`} />
      <View style={[styles.flex, { gap: 2 }]}>
        <Text style={text('sectionHeading')}>{exercise.exerciseName}</Text>
        {plan ? <Text style={text('body')}>{plan}</Text> : null}
        {lastLine ? <Text style={[text('caption'), styles.last]}>{lastLine}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: pressedOpacity },
  back: {
    width: tapTarget.min,
    height: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  title: { fontSize: 30 },
  bold: { fontFamily: fontFamilyFor('sans', 700) },
  ink: { color: palette.ink },
  centre: { textAlign: 'center' },
  stat: { flex: 1, alignItems: 'center', borderWidth: borderWidth.card, borderColor: palette.ink },
  statValue: { fontSize: 22 },
  // The coach's note is in the app's own font, never the handwriting one.
  note: { backgroundColor: palette.drop },
  noteLabel: { color: palette.ink, fontFamily: fontFamilyFor('sans', 700), textTransform: 'uppercase', letterSpacing: 0.6 },
  noteBody: { fontSize: 16, lineHeight: 22 },
  overline: { color: palette.ink, fontFamily: fontFamilyFor('sans', 700), textTransform: 'uppercase', letterSpacing: 0.6 },
  exercise: { borderWidth: borderWidth.card, borderColor: palette.border },
  last: { color: palette.magentaDeep, fontFamily: fontFamilyFor('sans', 700) },
});
