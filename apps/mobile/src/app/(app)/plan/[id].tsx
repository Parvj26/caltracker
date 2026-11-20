import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { borderWidth, tapTarget } from '@caltracker/design-tokens';
import {
  blockBadges,
  exerciseBadges,
  canStartSessionOn,
  localToday,
  sectionRuns,
  type Units,
  type WorkoutBlockDoc,
  type WorkoutExerciseDoc,
  workoutEquipment,
} from '@caltracker/shared';
import { ExerciseBadges } from '@/components/exercise-badges';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExerciseThumb } from '@/components/log/exercise-thumb';
import { Button, Card, ErrorText, Screen } from '@/components/ui';
import { BackButton } from '@/components/ui/nav-buttons';
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
  exerciseRest,
  lastTimeLine,
  planLineParts,
  planLineSpoken,
  planMeta,
  planTotals,
  previewSubtitle,
  supersetPlanInfo,
  type PlannedWorkout,
} from '@/lib/workouts-plan';
import { PlanLine } from '@/components/plan/plan-line';
import { palette, pressedOpacity, white } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';
import { fontFamilyFor } from '@/theme/fonts';

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

/**
 * Tap a workout on the Workouts tab (or Preview on Today): what it holds (every set, warm-ups and drops tagged), what
 * to bring, the coach's note, last time per exercise, and Start pinned at the bottom (approved Preview board).
 */
export default function PlanPreview() {
  const { id } = useLocalSearchParams<{ id: string }>();
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
  const equipment = useMemo(() => workoutEquipment(exerciseIds.map((x) => details[x]?.equipment)), [exerciseIds, details]);
  const badges = useMemo(() => (workout ? blockBadges(workout.doc.blocks) : []), [workout]);
  const status = workout ? (workoutStatuses(logs, active, finished, pending)[workout.doc.id] ?? null) : null;

  const footer = workout ? (
    status?.kind === 'done' ? (
      <Button title="View summary" testID="plan-view-log" onPress={() => openSummary(status.logId)} />
    ) : status?.kind === 'in_progress' ? (
      <Button title="Continue" testID="plan-start" ph-label="log_start_workout" onPress={() => openLog(status.logId)} />
    ) : canStartSessionOn(workout.scheduledOn, localToday()) ? (
      <Button
        title="Start workout"
        testID="plan-start"
        ph-label="log_start_workout"
        onPress={() => void startPlanned(workout.doc)}
        busy={starting === workout.doc.id}
      />
    ) : (
      <Text style={[text('body'), styles.centre]}>{`You can start this on ${formatDayLabel(workout.scheduledOn)}.`}</Text>
    )
  ) : null;

  return (
    <Screen footer={footer}>
      <BackButton testID="back" accessibilityLabel="Back to Workouts" fallback="/workouts" />

      {loaded.kind === 'loading' ? <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" /> : null}
      {loaded.kind === 'failed' ? (
        <Card>
          <ErrorText code="workout_load_failed">{LOAD_FAILED}</ErrorText>
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
            <Text style={[text('body'), styles.bold, styles.muted]}>
              {previewSubtitle(workout.scheduledOn, workout.programName, workout.programDay)}
            </Text>
            <Text style={[text('screenTitle'), styles.title]} accessibilityRole="header">
              {workout.doc.name}
            </Text>
            <Text testID="plan-meta" style={[text('body'), styles.bold]}>
              {planMeta(planTotals(workout.doc), true)}
            </Text>
            {equipment.length > 0 ? (
              <Text testID="plan-equipment" style={text('body')}>{`Bring: ${equipment.join(', ').toLowerCase()}`}</Text>
            ) : null}
          </View>

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
                <Text testID={`plan-section-${r}`} style={[text('sectionHeading'), styles.sectionTitle]} accessibilityRole="header">
                  {run.section.name}
                </Text>
              ) : null}
              {run.blockIndexes.map((i) => {
                const block = workout.doc.blocks[i];
                return block ? (
                  <BlockRows
                    key={block.id}
                    block={block}
                    badges={badges[i] ?? []}
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

/**
 * A block: a straight exercise as a row; a superset as one grey block (A1, A2, rounds and the rest after each round);
 * a pick-one group as one dashed block with OR between its options.
 */
function BlockRows({
  block,
  badges,
  units,
  last,
  details,
  onInfo,
}: {
  block: WorkoutBlockDoc;
  /** The shared blockBadges for this block ("A1", "A2" for a superset). */
  badges: string[];
  units: Units;
  last: LastResults | null;
  details: Record<string, ExerciseDetail>;
  onInfo: (e: WorkoutExerciseDoc) => void;
}) {
  const { text, space, radius } = useTheme();
  if (block.kind === 'straight') {
    const e = block.exercises[0];
    return e ? <ExerciseRow exercise={e} units={units} last={last} detail={details[e.exerciseId]} onInfo={() => onInfo(e)} /> : null;
  }
  if (block.kind === 'superset') {
    const info = supersetPlanInfo(block.exercises);
    return (
      <View testID={`plan-superset-${block.id}`} style={[styles.superset, { borderRadius: radius.card, padding: space[3], gap: space[1] }]}>
        {/* Wraps: at large text the rest goes under the heading instead of squeezing it. */}
        <View style={[styles.rowTop, styles.wrap, { columnGap: space[2] }]}>
          <Text style={[text('caption'), styles.overline, styles.grow]}>{info.heading}</Text>
          {info.rest ? <Text style={[text('caption'), styles.muted, styles.bold]}>{info.rest}</Text> : null}
        </View>
        {block.exercises.map((e, i) => (
          <ExerciseRow
            key={e.id}
            exercise={e}
            badge={badges[i] ?? null}
            units={units}
            last={last}
            detail={details[e.exerciseId]}
            onInfo={() => onInfo(e)}
            grouped
            divider={i > 0}
          />
        ))}
      </View>
    );
  }
  return (
    <View testID={`plan-pick-one-${block.id}`} style={[styles.pickOne, { borderRadius: radius.card, padding: space[3], gap: space[1] }]}>
      <Text style={[text('caption'), styles.overline]}>Pick one · you’ll choose when you get there</Text>
      {block.exercises.map((e, i) => (
        <Fragment key={e.id}>
          {i > 0 ? (
            <View style={[styles.rowTop, styles.orRow, { gap: space[2.5] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.orLine} />
              <Text style={[text('caption'), styles.bold, styles.muted]}>OR</Text>
              <View style={styles.orLine} />
            </View>
          ) : null}
          <ExerciseRow exercise={e} units={units} last={last} detail={details[e.exerciseId]} onInfo={() => onInfo(e)} grouped />
        </Fragment>
      ))}
    </View>
  );
}

function ExerciseRow({
  exercise,
  badge = null,
  units,
  last,
  detail,
  onInfo,
  grouped = false,
  divider = false,
}: {
  exercise: WorkoutExerciseDoc;
  /** "A1" in a superset: shown instead of the photo. */
  badge?: string | null;
  units: Units;
  last: LastResults | null;
  detail: ExerciseDetail | undefined;
  onInfo: () => void;
  /** Inside a superset or pick-one block: no frame of its own. */
  grouped?: boolean;
  divider?: boolean;
}) {
  const { text, space, radius } = useTheme();
  const parts = planLineParts(exercise, units);
  const lastLine = lastTimeLine(exercise, last, units);
  const rest = grouped ? null : exerciseRest(exercise);
  const sub = [lastLine, rest].filter(Boolean).join(' · ');
  const badges = exerciseBadges(exercise);
  return (
    <Pressable
      testID={`plan-exercise-${exercise.id}`}
      onPress={onInfo}
      accessibilityRole="button"
      accessibilityLabel={[badge, exercise.exerciseName, ...badges.badges, planLineSpoken(parts), badges.help, sub].filter(Boolean).join(', ')}
      accessibilityHint="Opens how to do it and the demo"
      style={({ pressed }) => [
        styles.rowTop,
        grouped ? undefined : [styles.exercise, { borderRadius: radius.button, paddingHorizontal: space[3] }],
        { paddingVertical: space[2.5], gap: space[3] },
        divider && styles.divider,
        pressed && styles.pressed,
      ]}
    >
      {badge ? (
        <View style={[styles.badge, { borderRadius: radius.input - 2 }]}>
          <Text style={[text('sectionHeading'), styles.badgeText]} maxFontSizeMultiplier={1.2}>
            {badge}
          </Text>
        </View>
      ) : (
        <ExerciseThumb name={exercise.exerciseName} detail={detail} testID={`plan-thumb-${exercise.id}`} />
      )}
      <View style={[styles.flex, { gap: 2 }]}>
        <Text style={text('sectionHeading')}>{exercise.exerciseName}</Text>
        <PlanLine parts={parts} />
        <ExerciseBadges badges={badges.badges} help={badges.help} testID={`plan-badges-${exercise.id}`} />
        {sub ? <Text style={[text('caption'), styles.muted]}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const BADGE = 36;

const styles = StyleSheet.create({
  rowTop: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  wrap: { flexWrap: 'wrap' },
  pressed: { opacity: pressedOpacity },
  back: {
    width: tapTarget.min,
    height: tapTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
  },
  title: { fontSize: 30 },
  sectionTitle: { fontSize: 18, marginTop: 4 },
  bold: { fontFamily: fontFamilyFor('sans', 700) },
  ink: { color: palette.ink },
  muted: { color: palette.inkMuted },
  centre: { textAlign: 'center' },
  // The coach's note is in the app's own font, never the handwriting one.
  note: { backgroundColor: palette.drop },
  noteLabel: { color: palette.magentaDeep, fontFamily: fontFamilyFor('sans', 800), textTransform: 'uppercase', letterSpacing: 0.6 },
  noteBody: { fontSize: 16, lineHeight: 22 },
  overline: { color: palette.ink, fontFamily: fontFamilyFor('sans', 800), textTransform: 'uppercase', letterSpacing: 0.6 },
  exercise: { borderWidth: borderWidth.card, borderColor: palette.border },
  superset: { backgroundColor: palette.surface },
  pickOne: { borderWidth: borderWidth.secondaryButton, borderStyle: 'dashed', borderColor: palette.borderStrong },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  orRow: { alignItems: 'center' },
  orLine: { flex: 1, height: 1, backgroundColor: palette.border },
  badge: { width: BADGE, height: BADGE, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: white, fontSize: 14 },
});
