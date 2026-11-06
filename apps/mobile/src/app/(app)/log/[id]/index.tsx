import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
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
  addLogExercise,
  addLogSet,
  formatLastResult,
  removeLogExercise,
  removeLogSet,
  resolveSetValues,
  setExerciseNote,
  stepSetValue,
  swapLogExercise,
  updateActual,
  type ActualPatch,
  type ExercisePick,
  type LogExerciseDoc,
  type LogSetDoc,
  type StepField,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import { EditSetsSheet } from '@/components/log/edit-sets-sheet';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExerciseListSheet } from '@/components/log/exercise-list-sheet';
import { ExercisePage, type PageHandlers } from '@/components/log/exercise-page';
import { ExercisePicker } from '@/components/log/exercise-picker';
import type { BlockHandlers } from '@/components/log/log-block';
import { LogTopBar } from '@/components/log/log-top-bar';
import { NoteSheet } from '@/components/log/note-sheet';
import { ProgressStrip } from '@/components/log/progress-strip';
import { RestPanel } from '@/components/log/rest-panel';
import { SupersetPage } from '@/components/log/superset-page';
import { SyncPill } from '@/components/log/sync-pill';
import { Button, Card, Screen } from '@/components/ui';
import { finishPrompt, finishQuestion } from '@/lib/active-log-logic';
import { fetchLastResults, type LastResults } from '@/lib/log-api';
import { restOverHaptic, tapHaptic } from '@/lib/log-notifications';
import {
  buildPageModel,
  firstOpenPage,
  listRows,
  pageAfterDone,
  pageIndexAfterChange,
  progressStates,
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

/** Which stored field each stepper writes. */
const PATCH_KEY: Record<StepField, keyof ActualPatch> = {
  weight: 'actualWeightKg',
  reps: 'actualReps',
  duration: 'actualDurationS',
  distance: 'actualDistanceM',
};

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
  const rows = useMemo(() => listRows(log), [log]);
  const states = useMemo(() => progressStates(log, pageIndex), [log, pageIndex]);
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
    // The summary replaces this screen, so Done (or back) on it returns to where the workout was started.
    if (await finish()) router.replace({ pathname: '/log/[id]/summary', params: { id: log.id } });
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
        const value = stepSetValue(field, s.value, dir, units);
        if (value === s.value) return;
        void op((l) => updateActual(l, cur.step.setId, { [PATCH_KEY[field]]: value }));
      },
      // Already in stored units (the stepper converts what was typed).
      onType: (field, value) => {
        const cur = model?.current;
        if (!cur) return;
        void op((l) => updateActual(l, cur.step.setId, { [PATCH_KEY[field]]: value }));
      },
      onDone: () => {
        const cur = model?.current;
        if (!cur || doneBusy.current) return;
        doneBusy.current = true;
        const { setId } = cur.step;
        const { values, after } = cur;
        // done() completes from the stored set, so a second tap that slips through completes nothing.
        void done(setId, values)
          .then((l) => {
            if (!l) return;
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
        let main = cur.step.setIndex;
        while (main > 0 && ex.sets[main]?.setType === 'drop') main -= 1;
        const mainId = ex.sets[main]?.id;
        if (mainId) void op((l) => addLogDrop(l, ex.id, mainId, randomUUID, nowIso()));
      },
      onPrev: () => goTo(p - 1),
      onNext: () => goTo(p + 1),
      onFocusExercise: (k) => block && setPrefer({ blockId: block.id, exerciseIndex: k }),
      onFinish: doFinish,
    };
  };

  // ---- Edit sets ----
  const editIndex = editBlockId === null ? -1 : log.blocks.findIndex((b) => b.id === editBlockId);
  const editBlock = editIndex >= 0 ? (log.blocks[editIndex] ?? null) : null;
  const editFirstExercise = log.blocks.slice(0, Math.max(0, editIndex)).reduce((n, b) => n + b.exercises.length, 0);
  const suggestedFor = (ex: LogExerciseDoc, setId: string) => resolveSetValues(ex, setId, lastSets(ex));

  const removeSet = (ex: LogExerciseDoc, set: LogSetDoc) => void op((l) => removeLogSet(l, ex.id, set.id, nowIso()));
  const editHandlers: BlockHandlers = {
    onTick: (ex, set) => {
      if (set.completedAt !== null) {
        void tick(set.id); // untick
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
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[column, { gap: sp[3], paddingTop: sp[2], paddingBottom: sp[3] }]}>
          <TimedTopBar
            startedAt={log.startedAt}
            pill={empty ? null : `${pageIndex + 1} of ${log.blocks.length}`}
            onBack={back}
            onPill={() => setListOpen(true)}
            onFinish={doFinish}
          />
          <SyncPill status={syncStatus} />
          {empty ? null : <ProgressStrip states={states} />}
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
              <ScrollView
                style={{ width }}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.pageContent, { paddingBottom: sp[6] + insets.bottom }]}
              >
                <View style={styles.pageColumn}>
                  {item.model.kind === 'superset' ? (
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
              </ScrollView>
            )}
          />
        )}
      </KeyboardAvoidingView>

      <ExerciseListSheet
        visible={listOpen}
        rows={rows}
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
});
