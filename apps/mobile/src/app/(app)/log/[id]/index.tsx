import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
  type HostInstance,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import {
  addLogExercise,
  addLogSet,
  chooseSubstitute,
  completeSetWith,
  completedSetCount,
  localToday,
  composeFinishNotes,
  readFinishNotes,
  removeLogExercise,
  removeLogSet,
  resolveSetValues,
  setExerciseNote,
  setLogNotes,
  swapLogExercise,
  updateActual,
  workoutEquipment,
  type ExercisePick,
  type Feeling,
  type LogExerciseDoc,
  type Units,
  type WorkoutLogDoc,
  type ProgressionHistory,
} from '@caltracker/shared';
import { ActionMenu, type MenuItem } from '@/components/log/action-menu';
import { CoachLoggingBanner } from '@/components/log/coach-logging-banner';
import { CoachWatchFrame, WindowInsets } from '@/components/log/coach-watch-bar';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExercisePicker } from '@/components/log/exercise-picker';
import { OptionPage, StraightPage, SupersetPage, type PageHandlers } from '@/components/log/log-pages';
import { FinishSheet, InfoSheet, SubstituteSheet } from '@/components/log/log-sheets';
import { NoteSheet } from '@/components/log/note-sheet';
import { SectionStart, WorkoutOverview } from '@/components/log/section-start';
import type { TableHandlers } from '@/components/log/set-table';
import { FieldNav, FieldNavContext, KEYBOARD_BAR_HEIGHT, KeyboardBar } from '@/components/log/set-table';
import { SyncPill } from '@/components/log/sync-pill';
import { Button, Card, Screen } from '@/components/ui';
import { CloseButton } from '@/components/ui/nav-buttons';
import { useCoachLogging } from '@/lib/coach-logging';
import { coachWatchView, latestTickedSetId, logControls, revealAfterCoachFinish } from '@/lib/coach-watch';
import { ignoreTick, type LastDone } from '@/lib/done-guard';
import { fetchLastResults, fetchProgression, readCachedDetail, type LastResults } from '@/lib/log-api';
import { fetchWorkoutDetail } from '@/lib/workouts-api';
import { useCoachProfile } from '@/lib/use-coach-profile';
import { coachFirstName } from '@/lib/workouts-plan';
import {
  addDropSet,
  addRound,
  exerciseMenu,
  setMenu as setMenuOf,
  buildPage,
  buildSections,
  deleteChoices,
  elapsedLabel,
  finishModel,
  hasTypedValues,
  headerLines,
  historyLines,
  markAll,
  markAllPlan,
  nextAction,
  notTickedTitle,
  openSetsOnPage,
  prefillSets,
  type Progression,
  markAllQuestion,
  pickingFirst,
  placeAfterChange,
  startGroups,
  startPlace,
  stepPlace,
  substituteCards,
  substituteOf,
  type ExerciseModel,
  type FlowPage,
  type FlowPlace,
  type FlowSection,
  type PageModel,
  type RowModel,
} from '@/lib/log-flow-model';
import { tapHaptic } from '@/lib/log-notifications';
import { useActiveLog } from '@/lib/use-active-log';
import { useDelayedFlag } from '@/lib/use-delayed-flag';
import { useExerciseDetails } from '@/lib/use-exercise-details';
import { useUnits } from '@/lib/use-units';
import { contentMaxWidth, palette, pressedOpacity, white } from '@/theme/theme';
import { logMaxFontScale } from '@/theme/typography';
import { useTheme } from '@/theme/use-theme';

type Screen = { mode: 'overview' } | { mode: 'start'; section: number } | { mode: 'pages'; section: number; page: number };
type Picker = { mode: 'add' } | { mode: 'swap'; ex: LogExerciseDoc };
type Info = { title: string; lines: string[]; testID: string };

/** Where each workout was left on this phone, so leaving and coming back (Resume) opens the same place. */
const lastScreen = new Map<string, Screen>();

/** "Not synced yet" shows only once changes have waited this long to upload. */
const SYNC_PILL_AFTER_MS = 4000;

const nowIso = () => new Date().toISOString();

const TAG_INFO: Record<'warmup' | 'drop' | 'failure', Info> = {
  warmup: {
    title: 'W · Warm-up set',
    lines: ['A lighter set to get ready. It doesn’t count towards your total weight lifted.'],
    testID: 'tag-info',
  },
  drop: {
    title: '↓ Drop set',
    lines: [
      'Straight after the set above, lower the weight and keep going. No rest in between.',
      'To failure: do as many reps as you can with good form, then type them in.',
    ],
    testID: 'tag-info',
  },
  failure: {
    title: 'F · To failure',
    lines: [
      'Keep going until you can’t do another rep with good form.',
      'Type the reps you got, then tick it.',
    ],
    testID: 'tag-info',
  },
};

/** The workout being logged: overview, each section's start page, and the section's pages. */
/** Delete is always red and confirmed (Patterns board). */
function confirmDeleteSet(what: string, run: () => void) {
  Alert.alert(`Delete ${what}?`, 'It is removed from this workout.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: run },
  ]);
}

export default function LogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Single active logger: while the coach logs this workout from the website, the client sees the same pages read
  // only, following the coach's saves live, under a slim bar (with "Continue on my phone" once the coach has stopped
  // for 20 minutes). Without an open copy on this phone (or once finished) the full banner shows instead.
  const coach = useCoachLogging(id);
  const router = useRouter();
  const { text } = useTheme();
  const { log: active, ready } = useActiveLog();
  const units = useUnits();
  const log = active && active.id === id ? active : null;

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/today')), [router]);
  const view = coachWatchView(coach.byCoach, log, id);
  // Watching when the coach finishes: straight to the sticker reveal, then the summary ("Logged by coach").
  const watched = useRef(false);
  useEffect(() => {
    // Handed back or reclaimed: the client logs again, so a later finish is theirs (their own reveal).
    if (view === 'watch') watched.current = true;
    else if (view === 'own') watched.current = false;
  }, [view]);
  const revealNow = revealAfterCoachFinish(watched.current || view === 'watch', coach);
  useEffect(() => {
    if (!revealNow || !id) return;
    watched.current = false;
    router.replace({ pathname: '/log/[id]/reveal', params: { id, coach: '1' } });
  }, [revealNow, id, router]);
  if (view === 'banner') return <CoachLoggingBanner coach={coach} onBack={back} />;

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

  const watching = view === 'watch';
  return (
    <CoachWatchFrame coach={watching ? coach : null}>
      <OpenLog log={log} units={units} back={back} readOnly={watching} />
    </CoachWatchFrame>
  );
}

/**
 * Where a fresh open lands: straight on the first set to do (Start goes to the first set, approved Today board); the
 * overview is one tap away in the header. An empty workout (unplanned, before its first exercise) opens its add page.
 */
function firstScreen(log: WorkoutLogDoc, sections: FlowSection[]): Screen {
  const remembered = lastScreen.get(log.id);
  if (remembered) return remembered;
  const at = startPlace(log, sections);
  return at ? { mode: 'pages', ...at } : { mode: 'start', section: 0 };
}

/** The coach's note on the planned workout (the log doesn't keep it): the copy saved on the phone, then the server's. */
function usePlanNote(workoutId: string | null): string | null {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!workoutId) return;
    let alive = true;
    void (async () => {
      const saved = await readCachedDetail(localToday(), workoutId).catch(() => null);
      if (alive && saved) setNote(saved.doc.notes ?? null);
      const fresh = await fetchWorkoutDetail(workoutId).catch(() => null);
      if (alive && fresh) setNote(fresh.doc.notes ?? null);
    })();
    return () => {
      alive = false;
    };
  }, [workoutId]);
  return note;
}

function OpenLog({ log, units, back, readOnly }: { log: WorkoutLogDoc; units: Units; back: () => void; readOnly: boolean }) {
  const router = useRouter();
  const { syncStatus, op: edit, tick: toggle, markDone: tickAll, finish, discard } = useActiveLog();
  // Read only (the coach logs it): every edit stops here too, not only in the hidden controls. The store refuses
  // them anyway (heldRef); this keeps a tap that lands mid-take-over from doing anything.
  const can = logControls(readOnly);
  const canRef = useRef(can);
  canRef.current = can;
  const op = useCallback((fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => (canRef.current.type ? edit(fn) : Promise.resolve()), [edit]);
  const tick = useCallback((setId: string) => (canRef.current.tick ? toggle(setId) : Promise.resolve(null)), [toggle]);
  const markDone = useCallback(
    (fn: (l: WorkoutLogDoc) => WorkoutLogDoc) => (canRef.current.tick ? tickAll(fn) : Promise.resolve(false)),
    [tickAll],
  );
  const recentSetId = useMemo(() => (readOnly ? latestTickedSetId(log) : null), [readOnly, log]);
  const coachName = coachFirstName(useCoachProfile()?.name);
  const planNote = usePlanNote(log.workoutId);
  // The number boxes in page order, for ‹ › on the keyboard bar (one per logging screen).
  const fieldNav = useMemo(() => new FieldNav(), []);
  const sections = useMemo(() => buildSections(log), [log]);
  const [screen, setScreenState] = useState<Screen>(() => firstScreen(log, sections));
  const setScreen = useCallback(
    (next: Screen) => {
      Keyboard.dismiss();
      lastScreen.set(log.id, next);
      setScreenState(next);
    },
    [log.id],
  );

  const [picker, setPicker] = useState<Picker | null>(null);
  const [noteFor, setNoteFor] = useState<LogExerciseDoc | null>(null);
  const [infoFor, setInfoFor] = useState<{ name: string; exerciseId: string } | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [menuFor, setMenuFor] = useState<LogExerciseDoc | null>(null);
  /** A set's menu (its ··· or a long press: Add drop set, Delete set), or "Delete set" → which set, from the ⋯ menu. */
  const [setMenu, setSetMenu] = useState<{ title: string; items: MenuItem[] } | null>(null);
  const [subFor, setSubFor] = useState<LogExerciseDoc | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [last, setLast] = useState<LastResults>({});
  const [history, setHistory] = useState<ProgressionHistory>({});
  const lastTick = useRef<LastDone>(null);
  // The coach took over while something was open: close what edits (photos, info and history may stay open).
  useEffect(() => {
    if (!readOnly) return;
    Keyboard.dismiss();
    setPicker(null);
    setNoteFor(null);
    setMenuFor(null);
    setSetMenu(null);
    setSubFor(null);
    setFinishOpen(false);
  }, [readOnly]);
  /** A block just added: open its page once the sections include it. */
  const jumpTo = useRef<string | null>(null);

  // ---- Keep the same page on screen when the log changes underneath (a removed exercise, an added one) ----
  const shape = sections.map((s) => `${s.key}:${s.pages.map((p) => p.key).join(',')}`).join('|');
  const prevSections = useRef(sections);
  useEffect(() => {
    const prev = prevSections.current;
    prevSections.current = sections;
    const target = jumpTo.current;
    if (target) {
      for (let s = 0; s < sections.length; s += 1) {
        const p = sections[s].pages.findIndex((x) => x.blockIndex >= 0 && log.blocks[x.blockIndex]?.id === target);
        if (p >= 0) {
          jumpTo.current = null;
          setScreen({ mode: 'pages', section: s, page: p });
          return;
        }
      }
    }
    if (screen.mode === 'overview') return;
    const before = prev[screen.section];
    const pageKey = screen.mode === 'pages' ? (before?.pages[screen.page]?.key ?? null) : null;
    const at = placeAfterChange(sections, { sectionKey: before?.key ?? '', pageKey, at: { section: screen.section, page: screen.mode === 'pages' ? screen.page : 0 } });
    if (screen.mode === 'start') {
      // An exercise was added to the empty workout: straight to its page.
      if (sections[at.section]?.pages.length) setScreen({ mode: 'pages', section: at.section, page: 0 });
      else if (at.section !== screen.section) setScreen({ mode: 'start', section: at.section });
    } else if (sections[at.section].pages.length === 0) {
      setScreen({ mode: 'start', section: at.section });
    } else if (at.section !== screen.section || at.page !== screen.page) {
      setScreen({ mode: 'pages', ...at });
    }
    // shape stands for sections here: only a change in the pages themselves moves the screen.
  }, [shape]);

  // ---- Data: exercise details (photos, equipment) and last time ----
  const exerciseIds = useMemo(
    () => [
      ...new Set(
        log.blocks.flatMap((b) =>
          b.exercises.flatMap((e) => [
            e.exerciseId,
            ...(e.swappedFromExerciseId ? [e.swappedFromExerciseId] : []),
            // The coach's substitutes too, so their photos and last time are ready when the client switches.
            ...e.substituteOptions.map((o) => o.exerciseId),
          ]),
        ),
      ),
    ],
    [log.blocks],
  );
  const exerciseKey = [...exerciseIds].sort().join(',');
  const details = useExerciseDetails(exerciseIds);
  useEffect(() => {
    if (!exerciseKey) return;
    let alive = true;
    fetchLastResults(exerciseKey.split(','))
      .then((r) => alive && setLast(r))
      .catch(() => undefined); // only a hint: no history beats an error
    return () => {
      alive = false;
    };
  }, [exerciseKey]);
  // Auto progression (only for a planned workout whose program has it on): the suggested weight becomes the pre-fill.
  const workoutId = log.workoutId;
  useEffect(() => {
    if (!exerciseKey || !workoutId) return;
    let alive = true;
    fetchProgression(workoutId, exerciseKey.split(','))
      .then((h) => alive && setHistory(h))
      .catch(() => undefined); // only a hint, like last time
    return () => {
      alive = false;
    };
  }, [exerciseKey, workoutId]);
  const equipment = useMemo(() => workoutEquipment(exerciseIds.map((x) => details[x]?.equipment)), [exerciseIds, details]);

  const blockOf = useCallback((logExerciseId: string) => log.blocks.find((b) => b.exercises.some((e) => e.id === logExerciseId)) ?? null, [log.blocks]);

  /** On a pick-one option, the edit picks that option first (or switches to it while nothing is ticked). */
  const withPick = useCallback(
    (logExerciseId: string) => (l: WorkoutLogDoc) => {
      const block = l.blocks.find((b) => b.exercises.some((e) => e.id === logExerciseId));
      return block?.kind === 'choice' ? pickingFirst(l, block.id, logExerciseId, nowIso()) : l;
    },
    [],
  );

  // ---- Edits ----
  // The handlers stay the same object across edits (they read the latest log and last time from refs), so a set
  // row redraws only when its own numbers change.
  const logRef = useRef(log);
  logRef.current = log;
  const lastRef = useRef(last);
  lastRef.current = last;
  const progressionRef = useRef<Progression>({ history, units });
  progressionRef.current = { history, units };
  const docOf = useCallback(
    (logExerciseId: string) => logRef.current.blocks.flatMap((b) => b.exercises).find((e) => e.id === logExerciseId) ?? null,
    [],
  );

  /**
   * Add drop set: a ↓ Drop row after the set, its weight at 75% of the set above (rounded down to the plate step),
   * and the cursor in its reps.
   */
  const addDropNow = useCallback(
    (exId: string, setId: string) => {
      const dropId = randomUUID();
      fieldNav.focusWhenReady(`${dropId}:reps`);
      void op((l) => {
        const picked = withPick(exId)(l);
        const doc = picked.blocks.flatMap((b) => b.exercises).find((e) => e.id === exId);
        if (!doc) return l;
        return addDropSet(picked, exId, setId, dropId, progressionRef.current.units, prefillSets(doc, lastRef.current, progressionRef.current), nowIso());
      });
    },
    [fieldNav, op, withPick],
  );

  const tableFor = useMemo(() => {
    const cache = new Map<string, TableHandlers>();
    return (ex: ExerciseModel): TableHandlers => {
      const exId = ex.logExerciseId;
      const known = cache.get(exId);
      if (known) return known;
      const pickFirst = withPick(exId);
      const made: TableHandlers = {
        onType: (row: RowModel, patch) => void op((l) => updateActual(pickFirst(l), row.setId, patch)),
        onTick: (row) => {
          const now = Date.now();
          if (ignoreTick(lastTick.current, row.setId, now)) return;
          lastTick.current = { setId: row.setId, at: now };
          Keyboard.dismiss();
          if (row.done) {
            void tick(row.setId);
            return;
          }
          // The numbers are worked out from the stored doc as the edit runs, like the boxes show them.
          void markDone((l) => {
            const picked = pickFirst(l);
            const doc = picked.blocks.flatMap((b) => b.exercises).find((e) => e.id === exId);
            if (!doc) return l;
            return completeSetWith(picked, row.setId, resolveSetValues(doc, row.setId, prefillSets(doc, lastRef.current, progressionRef.current)), nowIso());
          }).then((ticked) => ticked && tapHaptic());
        },
        onDelete: (row) => void op((l) => removeLogSet(l, exId, row.setId, nowIso())),
        onRowMenu: (row) => {
          Keyboard.dismiss();
          tapHaptic();
          const name = docOf(exId)?.exerciseName;
          // Add drop set above Delete set (approved SS3 board).
          const items: MenuItem[] = setMenuOf(row).map((m) =>
            m.key === 'add-drop'
              ? { title: m.title, testID: 'menu-row-add-drop', onPress: () => addDropNow(exId, row.setId) }
              : {
                  title: m.title,
                  testID: 'menu-delete-set',
                  destructive: true,
                  onPress: () => confirmDeleteSet(row.name, () => void op((l) => removeLogSet(l, exId, row.setId, nowIso()))),
                },
          );
          if (items.length > 0) setSetMenu({ title: name ? `${row.name} · ${name}` : row.name, items });
        },
        onTag: (row) => {
          if (row.tagKind !== 'normal') setInfo(TAG_INFO[row.tagKind]);
        },
      };
      cache.set(exId, made);
      return made;
    };
  }, [withPick, op, tick, markDone, docOf, addDropNow]);

  const handlers: PageHandlers = useMemo(
    () => ({
      table: tableFor,
      onAddSet: (ex) => void op((l) => addLogSet(withPick(ex.logExerciseId)(l), ex.logExerciseId, randomUUID, nowIso())),
      onAddRound: (m) => void op((l) => addRound(l, m.blockId, randomUUID, nowIso())),
      onInfo: (ex) => setInfoFor({ name: ex.name, exerciseId: ex.exerciseId }),
      onMessage: (ex) => {
        const doc = docOf(ex.logExerciseId);
        if (doc) setNoteFor(doc);
      },
      // ⇄: the coach's substitute when there is one still to choose, else any exercise from the library.
      onSwap: (ex) => {
        const doc = docOf(ex.logExerciseId);
        if (!doc) return;
        const sub = substituteOf(doc);
        if (sub && !sub.locked) setSubFor(doc);
        else setPicker({ mode: 'swap', ex: doc });
      },
      onSubstitute: (ex) => {
        Keyboard.dismiss();
        const doc = docOf(ex.logExerciseId);
        if (doc && substituteOf(doc)?.locked === false) setSubFor(doc);
      },
      onMore: (ex) => {
        const doc = docOf(ex.logExerciseId);
        if (doc) setMenuFor(doc);
      },
      onChoose: (blockId, logExerciseId) => {
        Keyboard.dismiss();
        void op((l) => pickingFirst(l, blockId, logExerciseId, nowIso()));
      },
    }),
    [tableFor, op, withPick, docOf],
  );

  /** Last time's sheet for an exercise (from ···): the date and each set. */
  const showHistory = (ex: LogExerciseDoc) => {
    const lines = historyLines(ex, last[ex.exerciseId]?.sets ?? [], units);
    const when = last[ex.exerciseId]?.finishedAt;
    setInfo({
      title: `Last time · ${ex.exerciseName}`,
      lines: lines.length > 0 ? [...(when ? [new Date(when).toDateString()] : []), ...lines] : ['First time. Your numbers will show here next time.'],
      testID: 'history-sheet',
    });
  };

  /** Mark all: asks first when it ticks more than one set, and says which get no weight and which it leaves. */
  const markAllNow = (logExerciseIds: string[], pickOf: string | null) => {
    Keyboard.dismiss();
    const picked = pickOf ? withPick(pickOf)(log) : log;
    const plan = markAllPlan(picked, logExerciseIds, last, { history, units });
    const run = () =>
      void markDone((l) => markAll(pickOf ? withPick(pickOf)(l) : l, logExerciseIds, lastRef.current, nowIso(), progressionRef.current)).then(
        (ticked) => ticked && tapHaptic(),
      );
    if (plan.tick === 0) {
      setInfo({
        title: 'Nothing to tick yet',
        lines: ['These sets have no numbers yet. Type them in, then tick each one.'],
        testID: 'mark-all-info',
      });
      return;
    }
    // One set with its numbers: no need to ask. A set with no weight (maybe bodyweight) is ticked, but said first.
    if (plan.tick === 1 && plan.skip === 0 && plan.noWeight === 0) return run();
    const q = markAllQuestion(plan);
    Alert.alert(q.title, q.message ?? undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Tick them', onPress: run },
    ]);
  };

  const menuItems: MenuItem[] = (() => {
    const ex = menuFor;
    if (!ex) return [];
    const lastMain = [...ex.sets].reverse().find((s) => s.setType === 'normal');
    const deletable = deleteChoices(ex, units, last[ex.exerciseId]?.sets ?? []);
    // Note for Demo, Last time, How to do it, Add set, Add drop set, Delete set, Remove exercise (approved SS5 board).
    return exerciseMenu(ex, { coachName, hasLastTime: !!last[ex.exerciseId], deletable: deletable.length > 0 }).map((m): MenuItem => {
      switch (m.key) {
        case 'note':
          return { title: m.title, testID: 'menu-note', onPress: () => setNoteFor(ex) };
        case 'history':
          return { title: m.title, testID: 'menu-history', onPress: () => showHistory(ex) };
        case 'info':
          return { title: m.title, testID: 'menu-info', onPress: () => setInfoFor({ name: ex.exerciseName, exerciseId: ex.exerciseId }) };
        case 'add-set':
          return { title: m.title, testID: 'menu-add-set', onPress: () => void op((l) => addLogSet(withPick(ex.id)(l), ex.id, randomUUID, nowIso())) };
        case 'add-drop':
          return { title: m.title, testID: 'menu-add-drop', onPress: () => lastMain && addDropNow(ex.id, lastMain.id) };
        case 'delete-set':
          return {
            title: m.title,
            testID: 'menu-delete-a-set',
            destructive: true,
            onPress: () =>
              setSetMenu({
                title: `Delete which set? · ${ex.exerciseName}`,
                items: deletable.map((c, i) => ({
                  title: c.title,
                  testID: `menu-delete-set-${i}`,
                  destructive: true,
                  onPress: () => confirmDeleteSet(c.title, () => void op((l) => removeLogSet(l, ex.id, c.setId, nowIso()))),
                })),
              }),
          };
        case 'remove':
          return { title: m.title, testID: 'menu-remove-exercise', destructive: true, onPress: () => confirmRemoveExercise(ex) };
      }
    });
  })();

  const confirmRemoveExercise = (ex: LogExerciseDoc) => {
    const choice = blockOf(ex.id)?.kind === 'choice';
    Alert.alert(`Remove ${ex.exerciseName}?`, choice ? 'The whole pick-one group is removed from this workout.' : 'Its sets are removed from this workout.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void op((l) => removeLogExercise(l, ex.id, nowIso())) },
    ]);
  };

  const pick = (choice: ExercisePick) => {
    const p = picker;
    setPicker(null);
    if (p?.mode === 'swap') {
      void op((l) => swapLogExercise(l, p.ex.id, choice, nowIso()));
      return;
    }
    void op((l) => {
      const next = addLogExercise(l, choice, randomUUID, nowIso());
      if (next !== l) jumpTo.current = next.blocks[next.blocks.length - 1]?.id ?? null;
      return next;
    });
  };

  /** "Resistance Training · Superset 3" over the substitute sheet. */
  const subContext = (ex: LogExerciseDoc): string => {
    for (const s of sections) {
      const page = s.pages.find((p) => log.blocks[p.blockIndex]?.exercises.some((e) => e.id === ex.id));
      if (page) return page.kind === 'superset' ? `${s.title} · Superset ${page.number}` : s.title;
    }
    return log.name;
  };

  // ---- Finish and discard ----
  // Read only: the coach may have taken over while the alert was open. iOS can't close an open Alert from code, so
  // its buttons do nothing then (the edits below are gated too).
  const discardNow = () => {
    if (canRef.current.discard) void discard().then(back);
  };
  const confirmDiscard = () =>
    Alert.alert('Discard this workout?', 'Your ticked sets won’t be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardNow },
    ]);
  /** ×: "Keep going later" (the workout stays open, Continue on Today) or "Discard workout". */
  const askLeave = () => {
    Keyboard.dismiss();
    if (!canRef.current.discard) return back();
    Alert.alert('Leave this workout?', 'Keep going later from Today, or throw it away.', [
      { text: 'Keep going later', onPress: back },
      { text: 'Discard workout', style: 'destructive', onPress: () => (completedSetCount(log) > 0 ? confirmDiscard() : discardNow()) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /** The bottom button: Next (asking first when sets on this page are not ticked) or Finish workout. */
  const goNext = (at: FlowPlace) => {
    const action = nextAction(log, sections, at);
    const move = () => (action.kind === 'finish' ? setFinishOpen(true) : setScreen({ mode: 'pages', ...action.to }));
    const page = sections[at.section]?.pages[at.page];
    const open = page && action.kind === 'next' ? openSetsOnPage(log, page) : { count: 0, logExerciseIds: [] };
    if (open.count === 0) return move();
    const pickOf = page?.kind === 'option' ? (open.logExerciseIds[0] ?? null) : null;
    Alert.alert(notTickedTitle(open.count), 'Tick them with the numbers shown, or skip them for today.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Skip them', onPress: move },
      {
        text: 'Tick all',
        onPress: () =>
          void markDone((l) => markAll(pickOf ? withPick(pickOf)(l) : l, open.logExerciseIds, lastRef.current, nowIso(), progressionRef.current)).then((ticked) => {
            if (ticked) tapHaptic();
            move();
          }),
      },
    ]);
  };
  const saved = readFinishNotes(log.notes);
  const finishNow = async (feel: Feeling | null, note: string) => {
    if (!canRef.current.finish) return;
    setFinishing(true);
    try {
      await op((l) => setLogNotes(l, composeFinishNotes(feel, note), nowIso()));
      // Finish, then the sticker reveal, then the summary. Each replaces this screen.
      if (await finish()) {
        lastScreen.delete(log.id);
        setFinishOpen(false);
        router.replace({ pathname: '/log/[id]/reveal', params: { id: log.id } });
      }
    } finally {
      setFinishing(false);
    }
  };

  const syncLate = useDelayedFlag(syncStatus !== 'synced', SYNC_PILL_AFTER_MS);

  const sheets = (
    <WindowInsets>
      <ExercisePicker
        title={picker?.mode === 'swap' ? `Swap ${picker.ex.exerciseName}` : 'Add an exercise'}
        visible={picker !== null}
        onPick={pick}
        onClose={() => setPicker(null)}
      />
      <ExerciseInfoSheet name={infoFor?.name ?? null} detail={infoFor ? details[infoFor.exerciseId] : undefined} onClose={() => setInfoFor(null)} />
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
      <InfoSheet title={info?.title ?? null} lines={info?.lines ?? []} testID={info?.testID ?? 'info-sheet'} onClose={() => setInfo(null)} />
      <SubstituteSheet
        context={subFor ? subContext(subFor) : null}
        cards={subFor ? substituteCards(subFor, units) : []}
        onChoose={(substituteId) => {
          const ex = subFor;
          setSubFor(null);
          if (!ex) return;
          // The other option gets its own planned sets: anything typed here (nothing is ticked yet) is cleared.
          const run = () => void op((l) => chooseSubstitute(l, ex.id, substituteId, randomUUID, nowIso()));
          if (!hasTypedValues(ex)) return run();
          // After the sheet has gone: iOS can't show an alert while a sheet is still closing.
          setTimeout(
            () =>
              Alert.alert('Switch exercise?', `The numbers you typed for ${ex.exerciseName} will be cleared.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Switch', onPress: run },
              ]),
            400,
          );
        }}
        onClose={() => setSubFor(null)}
      />
      <ActionMenu title={menuFor?.exerciseName ?? null} items={menuItems} onClose={() => setMenuFor(null)} />
      <ActionMenu title={setMenu?.title ?? null} items={setMenu?.items ?? []} onClose={() => setSetMenu(null)} />
      <KeyboardBar nav={fieldNav} />
      <FinishSheet
        visible={finishOpen}
        model={finishModel(log)}
        initialFeel={saved.feel}
        initialNote={saved.note}
        busy={finishing}
        coachName={coachName}
        onKeepGoing={(feel, note) => {
          // Keep the draft: the feeling and the note are saved with the workout, so closing loses nothing.
          setFinishOpen(false);
          void op((l) => setLogNotes(l, composeFinishNotes(feel, note), nowIso()));
        }}
        onSaveDraft={(feel, note) => void op((l) => setLogNotes(l, composeFinishNotes(feel, note), nowIso()))}
        onFinish={(feel, note) => void finishNow(feel, note)}
        onDiscard={() => {
          setFinishOpen(false);
          confirmDiscard();
        }}
      />
    </WindowInsets>
  );

  const pill = syncLate ? (
    <View pointerEvents="none" style={styles.syncPill}>
      <SyncPill status={syncStatus} />
    </View>
  ) : null;

  if (screen.mode === 'overview') {
    const at = startPlace(log, sections);
    const toPages = () => (at ? setScreen({ mode: 'pages', ...at }) : setScreen({ mode: 'start', section: 0 }));
    return (
      <View style={styles.fill}>
        <WorkoutOverview
          name={log.name}
          started={completedSetCount(log) > 0}
          sections={sections.map((section) => ({ section, groups: startGroups(log, section, units) }))}
          equipment={equipment}
          details={details}
          onStart={toPages}
          onSection={(i) => (sections[i]?.pages.length ? setScreen({ mode: 'pages', section: i, page: 0 }) : setScreen({ mode: 'start', section: i }))}
          onClose={toPages}
          onInfo={(item) => setInfoFor({ name: item.name, exerciseId: item.exerciseId })}
          onAddExercise={() => setPicker({ mode: 'add' })}
          onFinish={() => setFinishOpen(true)}
          onDiscard={confirmDiscard}
          readOnly={readOnly}
        />
        {pill}
        {sheets}
      </View>
    );
  }

  const sectionIndex = Math.min(screen.section, sections.length - 1);
  const section = sections[sectionIndex];

  if (screen.mode === 'start' || section.pages.length === 0) {
    const started = section.blockIndexes.some((bi) => log.blocks[bi].exercises.some((e) => e.sets.some((s) => s.completedAt !== null)));
    return (
      <SafeAreaView style={styles.fill} edges={['top', 'left', 'right']}>
        <SectionStart
          section={section}
          index={sectionIndex}
          of={sections.length}
          groups={startGroups(log, section, units)}
          details={details}
          started={started}
          onStart={() => setScreen({ mode: 'pages', section: sectionIndex, page: 0 })}
          onBack={askLeave}
          onInfo={(item) => setInfoFor({ name: item.name, exerciseId: item.exerciseId })}
          onAddExercise={() => setPicker({ mode: 'add' })}
          readOnly={readOnly}
        />
        {pill}
        {sheets}
      </SafeAreaView>
    );
  }

  const pageIndex = Math.min(screen.page, section.pages.length - 1);
  const here = { section: sectionIndex, page: pageIndex };
  // Moving: swipe (into the next or previous section too), the bottom button (Next / Finish), or the title, which
  // opens the whole workout.
  const go = (to: { section: number; page: number } | null) => to && setScreen({ mode: 'pages', ...to });
  const prevSection = stepPlace(sections, { section: sectionIndex, page: 0 }, -1);
  const nextSection = stepPlace(sections, { section: sectionIndex, page: section.pages.length - 1 }, 1);
  const action = nextAction(log, sections, here);
  const firstAt = sections.findIndex((x) => x.pages.length > 0);
  return (
    <FieldNavContext.Provider value={fieldNav}>
      <View style={styles.fill}>
        <SectionPages
          key={section.key}
          log={log}
          section={section}
          page={pageIndex}
          units={units}
          last={last}
          history={history}
          details={details}
          handlers={handlers}
          readOnly={readOnly}
          recentSetId={recentSetId}
          header={headerLines(log, sections, here)}
          coachName={coachName}
          // The coach's note sits on the workout's first page.
          coachNoteOn={sectionIndex === firstAt ? 0 : -1}
          coachNote={planNote}
          edges={{
            prev: prevSection ? sections[prevSection.section].title : null,
            next: nextSection ? sections[nextSection.section].title : null,
          }}
          nextLabel={action.kind === 'finish' ? 'Finish workout' : action.label}
          showNext={!readOnly && completedSetCount(log) > 0}
          onPage={(page) => setScreen({ mode: 'pages', section: sectionIndex, page })}
          onEdge={(delta) => go(delta < 0 ? prevSection : nextSection)}
          onSections={() => setScreen({ mode: 'overview' })}
          onClose={askLeave}
          onMarkAll={markAllNow}
          onNext={(page) => goNext({ section: sectionIndex, page })}
        />
        {pill}
        {sheets}
      </View>
    </FieldNavContext.Provider>
  );
}

/** A section's pages, swiped left and right, under a light header (×, the title that opens the workout, time in). */
function SectionPages({
  log,
  section,
  page,
  units,
  last,
  history,
  details,
  handlers,
  readOnly,
  recentSetId,
  header,
  coachName,
  coachNoteOn,
  coachNote,
  edges,
  nextLabel,
  showNext,
  onPage,
  onEdge,
  onSections,
  onClose,
  onMarkAll,
  onNext,
}: {
  log: WorkoutLogDoc;
  section: FlowSection;
  page: number;
  units: Units;
  last: LastResults;
  /** Auto progression history (empty when off). */
  history: ProgressionHistory;
  details: Parameters<typeof StraightPage>[0]['details'];
  handlers: PageHandlers;
  /** The coach logs this workout: the pages only show it (no Mark all or Next); moving around still works. */
  readOnly: boolean;
  recentSetId: string | null;
  /** "Lower Body · Main" over "Exercise 1 of 5 ▾". */
  header: { title: string; subtitle: string };
  coachName: string | null;
  /** The page showing the coach's note (-1: none in this section). */
  coachNoteOn: number;
  coachNote: string | null;
  /** The section a swipe past the first or last page goes on to (its title), or null. */
  edges: { prev: string | null; next: string | null };
  /** "Next: Leg Extension" or "Finish workout". */
  nextLabel: string;
  /** The bottom button shows once a set is ticked (never a Finish before anything is logged). */
  showNext: boolean;
  onPage: (page: number) => void;
  onEdge: (delta: -1 | 1) => void;
  /** The title: the workout overview, which lists every exercise. */
  onSections: () => void;
  onClose: () => void;
  /** Ticks every open set of these exercises; `pickOf` is the option a pick-one page picks first. */
  onMarkAll: (logExerciseIds: string[], pickOf: string | null) => void;
  onNext: (page: number) => void;
}) {
  const { text, logText, space, radius } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<FlowPage>>(null);
  const shown = useRef(page);
  const initial = useRef(page).current;
  /** A swipe-through page before the first page when there is a section before this one (and one after the last). */
  const lead = edges.prev ? 1 : 0;
  const elapsed = useElapsed(log.startedAt);

  const models = useMemo(() => section.pages.map((p) => buildPage(log, p, units, last, history)), [log, section, units, last, history]);

  // A page chosen from outside (Next, a change to the log): scroll there.
  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    listRef.current?.scrollToOffset({ offset: (page + lead) * width, animated: true });
  }, [page, width, lead]);

  // VoiceOver: each page that comes on screen (swiped, Next) is read from its heading.
  const headings = useRef(new Map<number, HostInstance>());
  const headingRef = useCallback(
    (index: number) => (node: HostInstance | null) => {
      if (node) headings.current.set(index, node);
      else headings.current.delete(index);
    },
    [],
  );
  const refFor = useMemo(() => section.pages.map((_, i) => headingRef(i)), [section.pages, headingRef]);
  useEffect(() => {
    const t = setTimeout(() => {
      const node = headings.current.get(page);
      const tag = node ? findNodeHandle(node) : null;
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 400);
    return () => clearTimeout(t);
  }, [page]);

  // A rotation or iPad resize changes the page width: stay on the same page.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: (shown.current + lead) * width, animated: false });
  }, [width, lead]);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const raw = Math.round(e.nativeEvent.contentOffset.x / width) - lead;
    // Swiped onto the next or previous section's edge page: go on into that section.
    if (raw < 0 && edges.prev) return onEdge(-1);
    if (raw >= section.pages.length && edges.next) return onEdge(1);
    const i = Math.min(Math.max(0, raw), section.pages.length - 1);
    if (i === shown.current) return;
    shown.current = i;
    Keyboard.dismiss();
    onPage(i);
  };

  /** Mark all for a page, or null when there is nothing to mark (all ticked). */
  const markFor = (m: PageModel): (() => void) | null => {
    if (readOnly || m.allDone) return null;
    const ids = m.kind === 'superset' ? m.exercises.map((e) => e.logExerciseId) : [m.exercise.logExerciseId];
    return () => onMarkAll(ids, m.kind === 'option' ? m.exercise.logExerciseId : null);
  };
  const what = (p: FlowPage) => (p.kind === 'superset' ? 'Superset' : p.kind === 'option' ? 'Pick one' : 'Exercise');

  return (
    <View style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + space[1], paddingHorizontal: space[3], paddingBottom: space[2], gap: space[2] }]}>
        <CloseButton testID="close-section" onPress={onClose} accessibilityLabel={readOnly ? 'Back' : 'Leave workout. Asks: keep going later or discard.'} />
        <Pressable
          testID="pages-title"
          onPress={onSections}
          accessibilityRole="button"
          accessibilityLabel={`${header.title}. ${header.subtitle.replace(' ▾', '')}`}
          accessibilityHint="Shows every exercise, to jump to any of them."
          style={({ pressed }) => [styles.headerTitle, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[logText('sectionHeading'), styles.centre]} numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_SCALE}>
            {header.title}
          </Text>
          <Text testID="pages-sections" style={[logText('caption'), styles.centre, styles.muted]} numberOfLines={1} maxFontSizeMultiplier={HEADER_MAX_SCALE}>
            {header.subtitle}
          </Text>
        </Pressable>
        <Text testID="log-elapsed" style={[text('caption'), styles.elapsed]} numberOfLines={2} adjustsFontSizeToFit maxFontSizeMultiplier={ELAPSED_MAX_SCALE}>
          {elapsed}
        </Text>
      </View>
      <FlatList
        ref={listRef}
        style={styles.fill}
        data={section.pages}
        extraData={models}
        keyExtractor={(p) => p.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        windowSize={3}
        initialNumToRender={1}
        initialScrollIndex={Math.min(initial, section.pages.length - 1)}
        getItemLayout={(_, index) => ({ length: width, offset: width * (index + lead), index })}
        ListHeaderComponent={edges.prev ? <EdgePage width={width} dir={-1} title={edges.prev} /> : undefined}
        ListFooterComponent={edges.next ? <EdgePage width={width} dir={1} title={edges.next} /> : undefined}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScrollToIndexFailed={(info) => listRef.current?.scrollToOffset({ offset: (info.index + lead) * width, animated: false })}
        renderItem={({ item, index }) => {
          const pageProps = (i: number) => ({
            page: i,
            units,
            details,
            handlers,
            headingRef: refFor[i] ?? null,
            readOnly,
            recentSetId,
            coachName,
            coachNote: i === coachNoteOn ? coachNote : null,
          });
          const m = models[index];
          return (
            <PageScroll
              page={index}
              testID={`page-${index}`}
              style={{ width }}
              // Room for the ‹ › Done bar above the number pad, so the last rows can scroll clear of it.
              contentContainerStyle={[styles.pageContent, { padding: space[4], paddingBottom: space[6] + KEYBOARD_BAR_HEIGHT }]}
            >
              <View style={styles.column} accessibilityLabel={`${what(item)} ${index + 1} of ${section.pages.length}`}>
                {m.kind === 'superset' ? (
                  <SupersetPage {...pageProps(index)} model={m} onMarkAll={markFor(m)} />
                ) : m.kind === 'option' ? (
                  <OptionPage {...pageProps(index)} model={m} onMarkAll={markFor(m)} />
                ) : (
                  <StraightPage {...pageProps(index)} model={m} onMarkAll={markFor(m)} />
                )}
              </View>
            </PageScroll>
          );
        }}
      />
      {showNext ? (
        <View style={[styles.footer, { paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: insets.bottom + space[2] }]}>
          <Pressable
            testID="page-done"
            ph-label={nextLabel === 'Finish workout' ? 'log_finish_workout' : undefined}
            onPress={() => onNext(page)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.done, { borderRadius: radius.pill, paddingHorizontal: space[4] }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[logText('button'), styles.onInk]} numberOfLines={1}>
              {nextLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A page's scroll view. It tells the keyboard bar how to scroll a focused box clear of the bar (iOS scrolls it above
 * the keyboard only).
 */
function PageScroll({ page, children, ...props }: { page: number; children: ReactNode } & Pick<ScrollViewProps, 'testID' | 'style' | 'contentContainerStyle'>) {
  const nav = useContext(FieldNavContext);
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  useEffect(() => nav?.registerScroller(page, (dy) => ref.current?.scrollTo({ y: offset.current + dy, animated: true })), [nav, page]);
  return (
    <ScrollView
      ref={ref}
      {...props}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      scrollEventThrottle={32}
      onScroll={(e) => {
        offset.current = e.nativeEvent.contentOffset.y;
      }}
    >
      {children}
    </ScrollView>
  );
}

/** "12 min in", updated every half minute. */
function useElapsed(startedAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return elapsedLabel(startedAt, now);
}

/** Past a section's first or last page: the section a swipe goes on to. Landing here opens it. */
function EdgePage({ width, dir, title }: { width: number; dir: -1 | 1; title: string }) {
  const { logText: text, space } = useTheme();
  return (
    <View testID={dir < 0 ? 'edge-prev' : 'edge-next'} style={[styles.edge, { width, padding: space[4], gap: space[2] }]}>
      <Text style={[text('caption'), styles.centre]}>{dir < 0 ? '‹ Previous section' : 'Next section ›'}</Text>
      <Text style={[text('screenTitle'), styles.centre]}>{title}</Text>
    </View>
  );
}

/** The header's title may grow this much with the phone's text size (1.6 at the app's size: same largest size). */
const HEADER_MAX_SCALE = logMaxFontScale(1.6);
/** "12 min in" sits in a narrow corner: it grows a little, then shrinks to fit (never split mid-word). */
const ELAPSED_MAX_SCALE = 1.2;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  onInk: { color: white },
  muted: { color: palette.inkMuted },
  header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.bg },
  closeButton: {
    width: tapTarget.min,
    height: tapTarget.min,
    borderRadius: tapTarget.min / 2,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, alignItems: 'center', minHeight: tapTarget.min, justifyContent: 'center' },
  elapsed: { width: 56, textAlign: 'right', color: palette.inkMuted },
  centre: { textAlign: 'center' },
  edge: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageContent: { alignItems: 'center' },
  column: { width: '100%', maxWidth: contentMaxWidth },
  footer: { alignItems: 'center', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.bg },
  done: {
    alignSelf: 'stretch',
    maxWidth: contentMaxWidth,
    minHeight: tapTarget.logging,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.ink,
  },
  syncPill: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
});
