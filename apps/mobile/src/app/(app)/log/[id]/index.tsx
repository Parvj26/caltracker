import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addLogDrop,
  dropParentId,
  addLogExercise,
  addLogSet,
  formatLastResult,
  liveExercises,
  pickChoice,
  removeLogExercise,
  removeLogSet,
  resolveSetValues,
  setExerciseNote,
  stepActual,
  swapLogExercise,
  updateActual,
  type ActualPatch,
  type ExercisePick,
  type LogExerciseDoc,
  type LogSetDoc,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { ChoicePage } from '@/components/log/choice-page';
import { CoachLoggingBanner } from '@/components/log/coach-logging-banner';
import { EditSetsSheet } from '@/components/log/edit-sets-sheet';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExerciseListSheet } from '@/components/log/exercise-list-sheet';
import { ExercisePage, type PageHandlers } from '@/components/log/exercise-page';
import { ExercisePicker } from '@/components/log/exercise-picker';
import { PageScroll } from '@/components/log/keyboard-reveal';
import type { BlockHandlers } from '@/components/log/log-block';
import { LogTopBar } from '@/components/log/log-top-bar';
import { NoteSheet } from '@/components/log/note-sheet';
import { MoveRow, UpNext } from '@/components/log/page-parts';
import { ProgressStrip } from '@/components/log/progress-strip';
import { RestPanel } from '@/components/log/rest-panel';
import { SupersetPage } from '@/components/log/superset-page';
import { SyncPill } from '@/components/log/sync-pill';
import { Button, Card, Screen } from '@/components/ui';
import { finishPrompt, finishQuestion } from '@/lib/active-log-logic';
import { ignoreDone, ignoreTick, type LastDone } from '@/lib/done-guard';
import { useCoachLogging } from '@/lib/coach-logging';
import { fetchLastResults, type LastResults } from '@/lib/log-api';
import { restOverHaptic, tapHaptic } from '@/lib/log-notifications';
import {
  buildPageModel,
  firstOpenPage,
  listSections,
  pageAfterDone,
  pageIndexAfterChange,
  pickFirstOnly,
  progressGroups,
  type PageModel,
} from '@/lib/log-page-model';
import { useActiveLog } from '@/lib/use-active-log';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { useUnits } from '@/lib/use-units';
import { supersetLetters } from '@/lib/workouts';
import { contentMaxWidth, palette, space } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Picker = { mode: 'add' } | { mode: 'swap'; ex: LogExerciseDoc };

const nowIso = () => new Date().toISOString();

/** The stored field a stepper's typed value goes into. */
function typedPatch(field: 'weight' | 'reps' | 'duration' | 'distance', value: number | null): ActualPatch {
  switch (field) {
    case 'weight':
      return { actualWeightKg: value };
    case 'reps':
      return { actualReps: value };
    case 'duration':
      return { actualDurationS: value };
    case 'distance':
      return { actualDistanceM: value };
  }
}

/** Seconds since `startIso`, ticking once a second. */
function useElapsed(startIso: string): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000));
}

/** The top bar with its own one-second clock, so the pages don't redraw every second. */
function TimedTopBar(props: { startedAt: string; pill: string | null; onBack: () => void; onPill: () => void; onFinish: () => void }) {
  const elapsedS = useElapsed(props.startedAt);
  return <LogTopBar pill={props.pill} elapsedS={elapsedS} onBack={props.onBack} onPill={props.onPill} onFinish={props.onFinish} />;
}

/** The workout being logged, one exercise (or superset) per page. */
export default function LogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text } = useTheme();
  const { log: active, ready } = useActiveLog();
  const units = useUnits();
  const log = active && active.id === id ? active : null;

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/today')), [router]);
  // Single active logger: while the coach logs this workout from the website, the client only sees a banner.
  const coach = useCoachLogging(id);

  if (coach.byCoach) return <CoachLoggingBanner coach={coach} onBack={back} />;

  if (!ready || units === null) {
    return (
      <Screen>
        <ActivityIndicator color={palette.ink} accessibilityLabel="Loading" />
      </Screen>
    );
  }

  if (!log || log.status !== 'in_progress') {
    return (
      <Screen>
        <Card>
          <Text style={text('sectionHeading')}>
            {log ? 'This workout is finished.' : 'This workout isn’t open on this phone any more.'}
          </Text>
          <Button variant="secondary" title="Back to Today" testID="back" onPress={back} />
        </Card>
      </Screen>
    );
  }

  return <OpenLog log={log} units={units} back={back} />;
}

function OpenLog({ log, units, back }: { log: WorkoutLogDoc; units: Units; back: () => void }) {
  const router = useRouter();
  const { text, space: sp } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { syncStatus, op, tick, done, finish, discard, rest, startRest, adjustRest, skipRest, endRest } = useActiveLog();

  const [picker, setPicker] = useState<Picker | null>(null);
  const [noteFor, setNoteFor] = useState<LogExerciseDoc | null>(null);
  const [infoFor, setInfoFor] = useState<LogExerciseDoc | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [editBlockId, setEditBlockId] = useState<string | null>(null);
  /** A superset card the client tapped; forgotten after the next Done. */
  const [prefer, setPrefer] = useState<{ blockId: string; exerciseIndex: number } | null>(null);
  const [last, setLast] = useState<LastResults>({});

  // ---- Pages ----
  const blockIds = useMemo(() => log.blocks.map((b) => b.id), [log.blocks]);
  const [pageIndex, setPageIndex] = useState(() => firstOpenPage(log));
  const pages = useRef({ blockIds, index: pageIndex });
  /** Read once by the list when it first draws; later moves go through goTo. */
  const initialPage = useRef(pageIndex).current;
  const listRef = useRef<FlatList<{ key: string; model: PageModel }>>(null);
  /** A page just added: jump to it once it is drawn. */
  const jumpTo = useRef<string | null>(null);
  const doneBusy = useRef(false);
  /** The last set completed by Done, and by a ✓ in Edit sets: a fast second tap is the same tap. */
  const lastDone = useRef<LastDone>(null);
  const lastTick = useRef<LastDone>(null);

  const scrollTo = useCallback(
    (index: number, animated: boolean) => {
      if (index < 0 || index >= pages.current.blockIds.length) return;
      listRef.current?.scrollToOffset({ offset: index * width, animated });
    },
    [width],
  );

  const goTo = useCallback(
    (index: number, animated = true) => {
      const n = pages.current.blockIds.length;
      if (n === 0) return;
      const i = Math.min(Math.max(0, index), n - 1);
      // A box still being typed in would show its old draft on the next page.
      Keyboard.dismiss();
      pages.current = { ...pages.current, index: i };
      setPageIndex(i);
      scrollTo(i, animated);
    },
    [scrollTo],
  );

  // Pages added, removed or reordered: keep the same page on screen (or jump to one just added).
  const idsKey = blockIds.join(',');
  useEffect(() => {
    const prev = pages.current;
    if (prev.blockIds.join(',') === idsKey) return;
    const target = jumpTo.current;
    jumpTo.current = null;
    const added = target ? blockIds.indexOf(target) : -1;
    const next = added >= 0 ? added : pageIndexAfterChange(prev, blockIds);
    pages.current = { blockIds, index: next };
    setPageIndex(next);
    // After the list has drawn its new pages. (idsKey stands for blockIds in the deps.)
    requestAnimationFrame(() => scrollTo(next, added >= 0));
  }, [idsKey]);

  // A rotation or iPad resize changes the page width: stay on the same page.
  useEffect(() => {
    scrollTo(pages.current.index, false);
  }, [scrollTo]);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const n = pages.current.blockIds.length;
    const i = Math.min(Math.max(0, Math.round(e.nativeEvent.contentOffset.x / width)), Math.max(0, n - 1));
    if (i === pages.current.index) return;
    pages.current = { ...pages.current, index: i };
    setPageIndex(i);
  };

  // ---- Data for the pages ----
  // "Last time" for every exercise in the log; reloaded only when the set of exercises changes.
  const exerciseKey = useMemo(
    () => [...new Set(log.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)))].sort().join(','),
    [log],
  );
  const details = useExerciseDetails(useMemo(() => (exerciseKey ? exerciseKey.split(',') : []), [exerciseKey]));
  useEffect(() => {
    if (!exerciseKey) return;
    let alive = true;
    fetchLastResults(exerciseKey.split(','))
      .then((r) => alive && setLast(r))
      .catch(() => undefined); // only a hint: no line beats an error
    return () => {
      alive = false;
    };
  }, [exerciseKey]);

  const models = useMemo(
    () =>
      log.blocks.map((b, blockIndex) =>
        buildPageModel({
          log,
          blockIndex,
          units,
          last,
          preferExerciseIndex: prefer?.blockId === b.id ? prefer.exerciseIndex : undefined,
        }),
      ),
    [log, units, last, prefer],
  );
  // The list sheet draws the sections with their headings; the move row's names read the rows by page.
  const sections = useMemo(() => listSections(log), [log]);
  const rows = useMemo(() => {
    const byPage: Array<{ title: string } | undefined> = [];
    for (const row of sections.flatMap((s) => s.rows)) byPage[row.pageIndex] = row;
    return byPage;
  }, [sections]);
  const groups = useMemo(() => progressGroups(log, pageIndex), [log, pageIndex]);
  const letters = useMemo(() => supersetLetters(log.blocks), [log.blocks]);
  const data = useMemo(() => models.map((model, i) => ({ key: log.blocks[i]?.id ?? String(i), model })), [models, log.blocks]);

  const lastSets = useCallback((ex: LogExerciseDoc) => last[ex.exerciseId]?.sets ?? [], [last]);
  const lastTime = useCallback(
    (ex: LogExerciseDoc) => formatLastResult(lastSets(ex), ex.trackingType, units),
    [lastSets, units],
  );

  const restDone = useCallback(
    (late: boolean) => {
      // The scheduled notification plays the sound; the buzz only when the client is here to feel it.
      if (!late) restOverHaptic();
      endRest();
    },
    [endRest],
  );

  // ---- Finish and discard (as before) ----
  const discardNow = () => void discard().then(back);
  const confirmDiscard = () =>
    Alert.alert('Discard this workout?', 'Your ticked sets won’t be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardNow },
    ]);

  const finishNow = async () => {
    // Finish, then the sticker reveal, then the summary. Each replaces this screen, so Done (or back) on the
    // summary returns to where the workout was started.
    if (await finish()) router.replace({ pathname: '/log/[id]/reveal', params: { id: log.id } });
  };

  const doFinish = () => {
    // Asked from what this screen shows; finish() then decides again from the stored doc with the shared rules.
    const prompt = finishPrompt(log, nowIso());
    if (prompt.kind === 'none-done') {
      // A workout with nothing ticked can't be finished: the only ways out are Discard or keep going.
      Alert.alert('Complete at least one set to finish.', undefined, [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardNow },
      ]);
    } else if (prompt.kind === 'unticked') {
      Alert.alert(finishQuestion(prompt.count), undefined, [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Finish', onPress: () => void finishNow() },
      ]);
    } else {
      void finishNow();
    }
  };

  const confirmRemoveExercise = (ex: LogExerciseDoc) =>
    Alert.alert(`Remove ${ex.exerciseName}?`, 'Its sets are removed from this workout.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void op((l) => removeLogExercise(l, ex.id, nowIso())) },
    ]);

  const pick = (choice: ExercisePick) => {
    const p = picker;
    setPicker(null);
    if (p?.mode === 'swap') {
      void op((l) => swapLogExercise(l, p.ex.id, choice, nowIso()));
      return;
    }
    void op((l) => {
      const next = addLogExercise(l, choice, randomUUID, nowIso());
      // The new exercise is the last page; the screen jumps to it once it is drawn.
      if (next !== l) jumpTo.current = next.blocks[next.blocks.length - 1]?.id ?? null;
      return next;
    });
  };

  // ---- One page's buttons ----
  const pageHandlers = (p: number): PageHandlers => {
    const block = log.blocks[p];
    const model = models[p];
    const exAt = (k: number) => block?.exercises[k];
    return {
      onStep: (field, dir) => {
        const cur = model?.current;
        const s = cur?.steppers.find((x) => x.field === field);
        if (!cur || !s) return;
        // Worked out inside the queued edit from the stored number, so fast presses all count.
        void op((l) => stepActual(l, cur.step.setId, field, dir, units, s.value));
      },
      // Already in stored units (the stepper converts what was typed).
      onType: (field, value) => {
        const cur = model?.current;
        if (!cur) return;
        void op((l) => updateActual(l, cur.step.setId, typedPatch(field, value)));
      },
      onDone: () => {
        Keyboard.dismiss();
        const cur = model?.current;
        if (!cur || doneBusy.current || ignoreDone(lastDone.current, cur.step.setId, Date.now())) return;
        doneBusy.current = true;
        const { setId } = cur.step;
        const { values, after } = cur;
        // done() completes from the stored set, so a second tap that slips through completes nothing.
        void done(setId, values)
          .then((l) => {
            if (!l) return;
            lastDone.current = { setId, at: Date.now() };
            tapHaptic();
            if (after.kind === 'rest' && after.seconds > 0) startRest(log.id, after.seconds);
            setPrefer(null);
            const target = pageAfterDone(l, p);
            if (target !== p) goTo(target);
          })
          .finally(() => {
            doneBusy.current = false;
          });
      },
      onEditSets: () => block && setEditBlockId(block.id),
      onNote: (k) => {
        const ex = exAt(k);
        if (ex) setNoteFor(ex);
      },
      onSwap: (k) => {
        const ex = exAt(k);
        if (ex) setPicker({ mode: 'swap', ex });
      },
      onHowTo: (k) => {
        const ex = exAt(k);
        if (ex) setInfoFor(ex);
      },
      onAddDrop: () => {
        const cur = model?.current;
        const ex = cur ? exAt(cur.step.exerciseIndex) : undefined;
        if (!cur || !ex) return;
        // The new drop goes after the last one of this set: its parent is the main set above the current step.
        const mainId = dropParentId(ex, cur.step.setIndex);
        if (mainId) void op((l) => addLogDrop(l, ex.id, mainId, randomUUID, nowIso()));
      },
      onPrev: () => goTo(p - 1),
      onNext: () => goTo(p + 1),
      onFocusExercise: (k) => block && setPrefer({ blockId: block.id, exerciseIndex: k }),
      onFinish: doFinish,
      // Back to the option cards; the shared rule refuses once the picked option has a done set.
      onSwitch: () => {
        if (block) void op((l) => pickChoice(l, block.id, null, nowIso()));
      },
    };
  };

  /**
   * A card on a pick-one page: saved and synced like every other edit (op → applyEdit → sync). Only the first
   * tap picks (decided from the stored doc); changing the pick goes through Switch.
   */
  const pickOption = (p: number, logExerciseId: string) => {
    const block = log.blocks[p];
    if (!block) return;
    tapHaptic();
    void op((l) => pickFirstOnly(l, block.id, logExerciseId, nowIso()));
  };

  // ---- Edit sets ----
  const editIndex = editBlockId === null ? -1 : log.blocks.findIndex((b) => b.id === editBlockId);
  const editBlockAll = editIndex >= 0 ? (log.blocks[editIndex] ?? null) : null;
  // Edit sets on a pick-one page shows the picked option only (the options left behind are not part of the workout).
  const editBlock = useMemo(
    () =>
      editBlockAll?.kind === 'choice'
        ? { ...editBlockAll, exercises: liveExercises(editBlockAll).map(({ exercise }) => exercise) }
        : editBlockAll,
    [editBlockAll],
  );
  useEffect(() => {
    // Its only exercise was removed: forget the sheet, so it can't come back for a block that is gone.
    if (editBlockId !== null && editIndex < 0) setEditBlockId(null);
  }, [editBlockId, editIndex]);
  const editFirstExercise = log.blocks.slice(0, Math.max(0, editIndex)).reduce((n, b) => n + b.exercises.length, 0);
  const suggestedFor = (ex: LogExerciseDoc, setId: string) => resolveSetValues(ex, setId, lastSets(ex));

  const removeSet = (ex: LogExerciseDoc, set: LogSetDoc) => void op((l) => removeLogSet(l, ex.id, set.id, nowIso()));
  const editHandlers: BlockHandlers = {
    onTick: (ex, set) => {
      const now = Date.now();
      if (ignoreTick(lastTick.current, set.id, now)) return;
      lastTick.current = { setId: set.id, at: now };
      if (set.completedAt !== null) {
        // Untick: the set may become the current step again, so Done must not take it for a repeat tap.
        if (lastDone.current?.setId === set.id) lastDone.current = null;
        void tick(set.id);
        return;
      }
      // Ticking here saves the pre-filled numbers like Done, without a rest.
      void done(set.id, suggestedFor(ex, set.id)).then((l) => l && tapHaptic());
    },
    onChange: (set, patch) => void op((l) => updateActual(l, set.id, patch)),
    // The sheet opens its own menus and info sheet.
    onSetMenu: () => undefined,
    onExerciseMenu: () => undefined,
    onExerciseInfo: () => undefined,
    // The swipe's Delete button runs exactly what the set menu's "Remove set" runs.
    onRemoveSet: removeSet,
    // Asked of the shared rule itself: it returns the same doc when it refuses.
    canRemoveSet: (ex, set) => removeLogSet(log, ex.id, set.id, nowIso()) !== log,
    onAddSet: (ex) => void op((l) => addLogSet(l, ex.id, randomUUID, nowIso())),
  };

  const restHere = rest?.logId === log.id ? rest : null;
  // Everything a page draws that isn't in `data`: a change here redraws the pages too.
  const extraData = useMemo(() => ({ restHere, rows, details }), [restHere, rows, details]);
  const onScreen = models[pageIndex];
  const empty = log.blocks.length === 0;
  const column = [styles.column, { paddingHorizontal: space[4] }];

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
      {/* No KeyboardAvoidingView: each page's ScrollView makes room for the keyboard itself (PageScroll); both
          together left a double gap and pushed the steppers under the bar. */}
      <View style={styles.fill}>
        <View style={[column, styles.header, { gap: sp[3], paddingTop: sp[2], paddingBottom: sp[3] }]}>
          <View>
            <TimedTopBar
              startedAt={log.startedAt}
              pill={empty ? null : `${pageIndex + 1} of ${log.blocks.length}`}
              onBack={back}
              onPill={() => setListOpen(true)}
              onFinish={doFinish}
            />
            {/* Floats under the top bar: it comes and goes after every change, and in the flow it moved Done
                and Skip out from under the finger. Taps pass through it. */}
            <View pointerEvents="none" style={styles.syncPill}>
              <SyncPill status={syncStatus} />
            </View>
          </View>
          {empty ? null : <ProgressStrip groups={groups} />}
          {restHere ? (
            <RestPanel
              endsAt={restHere.endsAt}
              totalS={restHere.totalS}
              nextLine={onScreen?.nextLine ? `Next: ${onScreen.nextLine}` : null}
              onAdjust={adjustRest}
              onSkip={skipRest}
              onDone={restDone}
            />
          ) : null}
        </View>

        {empty ? (
          <ScrollView contentContainerStyle={[styles.pageContent, { paddingBottom: sp[6] + insets.bottom }]}>
            <View style={styles.pageColumn}>
              <Card>
                <Text style={text('body')}>Add your first exercise to start logging.</Text>
                <Button
                  variant="secondary"
                  title="+ Add exercise"
                  testID="add-exercise"
                  onPress={() => setPicker({ mode: 'add' })}
                />
              </Card>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.fill}
            data={data}
            extraData={extraData}
            keyExtractor={(item) => item.key}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            windowSize={3}
            initialNumToRender={1}
            initialScrollIndex={Math.min(initialPage, data.length - 1)}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScrollToIndexFailed={(info) => scrollTo(info.index, false)}
            renderItem={({ item, index }) => (
              <PageScroll
                style={{ width }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={[styles.pageContent, { paddingBottom: sp[6] + insets.bottom }]}
              >
                <View style={styles.pageColumn}>
                  {item.model.choice && !item.model.choice.picked ? (
                    <View style={{ gap: sp[3] }}>
                      <ChoicePage
                        model={item.model.choice}
                        page={index}
                        details={details}
                        onPick={(logExerciseId) => pickOption(index, logExerciseId)}
                      />
                      <MoveRow
                        page={index}
                        prevName={rows[index - 1]?.title ?? null}
                        nextName={rows[index + 1]?.title ?? null}
                        onPrev={() => goTo(index - 1)}
                        onNext={() => goTo(index + 1)}
                      />
                      <UpNext page={index} text={item.model.upNext} />
                    </View>
                  ) : item.model.kind === 'superset' ? (
                    <SupersetPage
                      model={item.model}
                      page={index}
                      resting={restHere !== null}
                      handlers={pageHandlers(index)}
                      prevName={rows[index - 1]?.title ?? null}
                      nextName={rows[index + 1]?.title ?? null}
                      details={details}
                    />
                  ) : (
                    <ExercisePage
                      model={item.model}
                      page={index}
                      resting={restHere !== null}
                      handlers={pageHandlers(index)}
                      prevName={rows[index - 1]?.title ?? null}
                      nextName={rows[index + 1]?.title ?? null}
                      detail={item.model.exercises[0] ? details[item.model.exercises[0].exerciseId] : undefined}
                    />
                  )}
                </View>
              </PageScroll>
            )}
          />
        )}
      </View>

      <ExerciseListSheet
        visible={listOpen}
        sections={sections}
        current={pageIndex}
        onPick={(i) => goTo(i)}
        onAdd={() => setPicker({ mode: 'add' })}
        onDiscard={confirmDiscard}
        onClose={() => setListOpen(false)}
      />
      <EditSetsSheet
        visible={editBlockId !== null}
        block={editBlock}
        letter={editIndex >= 0 ? (letters[editIndex] ?? null) : null}
        firstExerciseIndex={editFirstExercise}
        units={units}
        details={details}
        lastTime={lastTime}
        suggested={(setId) => {
          const ex = editBlock?.exercises.find((e) => e.sets.some((s) => s.id === setId));
          return ex ? suggestedFor(ex, setId) : undefined;
        }}
        handlers={editHandlers}
        onClose={() => setEditBlockId(null)}
        onSwap={(ex) => setPicker({ mode: 'swap', ex })}
        onNote={(ex) => setNoteFor(ex)}
        onAddDrop={(ex, set) => void op((l) => addLogDrop(l, ex.id, set.id, randomUUID, nowIso()))}
        onRemoveExercise={confirmRemoveExercise}
      />
      <ExercisePicker
        title={picker?.mode === 'swap' ? `Swap ${picker.ex.exerciseName}` : 'Add an exercise'}
        visible={picker !== null}
        onPick={pick}
        onClose={() => setPicker(null)}
      />
      <ExerciseInfoSheet
        name={infoFor?.exerciseName ?? null}
        detail={infoFor ? details[infoFor.exerciseId] : undefined}
        onClose={() => setInfoFor(null)}
      />
      <NoteSheet
        exerciseName={noteFor?.exerciseName ?? null}
        initial={noteFor?.note ?? ''}
        onSave={(note) => {
          const ex = noteFor;
          setNoteFor(null);
          if (ex) void op((l) => setExerciseNote(l, ex.id, note, nowIso()));
        }}
        onClose={() => setNoteFor(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  column: { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' },
  pageContent: { alignItems: 'center', paddingHorizontal: space[4], paddingTop: space[2] },
  pageColumn: { width: '100%', maxWidth: contentMaxWidth },
  // Above the pages, so the floating sync pill draws over them.
  header: { zIndex: 1 },
  syncPill: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1, marginTop: space[1] },
});
