import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { tapTarget } from '@caltracker/design-tokens';
import {
  addLogDrop,
  addLogExercise,
  addLogSet,
  chooseSubstitute,
  completeSetWith,
  completedSetCount,
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
} from '@caltracker/shared';
import { ActionMenu, type MenuItem } from '@/components/log/action-menu';
import { CoachLoggingBanner } from '@/components/log/coach-logging-banner';
import { ExerciseInfoSheet } from '@/components/log/exercise-info-sheet';
import { ExercisePicker } from '@/components/log/exercise-picker';
import { OptionPage, StraightPage, SupersetPage, type PageHandlers } from '@/components/log/log-pages';
import { FinishSheet, InfoSheet, SubstituteSheet } from '@/components/log/log-sheets';
import { NoteSheet } from '@/components/log/note-sheet';
import { SectionStart, WorkoutOverview } from '@/components/log/section-start';
import type { TableHandlers } from '@/components/log/set-table';
import { KeyboardBar } from '@/components/log/set-table';
import { SyncPill } from '@/components/log/sync-pill';
import { Button, Card, Screen } from '@/components/ui';
import { useCoachLogging } from '@/lib/coach-logging';
import { ignoreTick, type LastDone } from '@/lib/done-guard';
import { fetchLastResults, type LastResults } from '@/lib/log-api';
import {
  afterDone,
  buildPage,
  buildSections,
  deleteChoices,
  finishModel,
  hasTypedValues,
  historyLines,
  markAll,
  markAllPlan,
  markAllQuestion,
  pageDots,
  pickingFirst,
  placeAfterChange,
  resumePlace,
  startGroups,
  stepLabel,
  stepPlace,
  substituteCards,
  substituteOf,
  type ExerciseModel,
  type FlowPage,
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
    title: 'D · Drop set',
    lines: ['Straight after the set above, lower the weight and keep going. No rest in between.'],
    testID: 'tag-info',
  },
  failure: {
    title: 'F · To failure',
    lines: [
      'A drop set done to failure: keep going until you can’t do another rep with good form.',
      'Type the reps you got, then tick it.',
    ],
    testID: 'tag-info',
  },
};

/** The workout being logged: overview, each section's start page, and the section's pages. */
export default function LogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Single active logger: while the coach logs this workout from the website, the client sees a read-only banner
  // (with "Continue on my phone" once the coach has stopped for 20 minutes) instead of the logging pages.
  const coach = useCoachLogging(id);
  const router = useRouter();
  const { text } = useTheme();
  const { log: active, ready } = useActiveLog();
  const units = useUnits();
  const log = active && active.id === id ? active : null;

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/today')), [router]);
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

/** Where a fresh open lands: the overview before anything is ticked, else the first open page. */
function firstScreen(log: WorkoutLogDoc, sections: FlowSection[]): Screen {
  const remembered = lastScreen.get(log.id);
  if (remembered) return remembered;
  if (completedSetCount(log) === 0) return { mode: 'overview' };
  const at = resumePlace(log, sections);
  return at ? { mode: 'pages', ...at } : { mode: 'overview' };
}

function OpenLog({ log, units, back }: { log: WorkoutLogDoc; units: Units; back: () => void }) {
  const router = useRouter();
  const { syncStatus, op, tick, markDone, finish, discard } = useActiveLog();
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
  /** Deleting a set: the long-press sheet on a row, or "Delete a set" from the ⋯ menu. */
  const [setMenu, setSetMenu] = useState<{ title: string; items: MenuItem[] } | null>(null);
  const [subFor, setSubFor] = useState<LogExerciseDoc | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [last, setLast] = useState<LastResults>({});
  const lastTick = useRef<LastDone>(null);
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
      if (at.section !== screen.section) setScreen({ mode: 'start', section: at.section });
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
  const docOf = useCallback(
    (logExerciseId: string) => logRef.current.blocks.flatMap((b) => b.exercises).find((e) => e.id === logExerciseId) ?? null,
    [],
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
            return completeSetWith(picked, row.setId, resolveSetValues(doc, row.setId, lastRef.current[doc.exerciseId]?.sets ?? []), nowIso());
          }).then((ticked) => ticked && tapHaptic());
        },
        onDelete: (row) => void op((l) => removeLogSet(l, exId, row.setId, nowIso())),
        onRowMenu: (row) => {
          Keyboard.dismiss();
          tapHaptic();
          const name = docOf(exId)?.exerciseName;
          setSetMenu({
            title: name ? `${row.name} · ${name}` : row.name,
            items: [{ title: 'Delete set', testID: 'menu-delete-set', onPress: () => void op((l) => removeLogSet(l, exId, row.setId, nowIso())) }],
          });
        },
        onTag: (row) => {
          if (row.tagKind !== 'normal') setInfo(TAG_INFO[row.tagKind]);
        },
      };
      cache.set(exId, made);
      return made;
    };
  }, [withPick, op, tick, markDone, docOf]);

  const handlers: PageHandlers = useMemo(
    () => ({
      table: tableFor,
      onAddSet: (ex) => void op((l) => addLogSet(withPick(ex.logExerciseId)(l), ex.logExerciseId, randomUUID, nowIso())),
      onInfo: (ex) => setInfoFor({ name: ex.name, exerciseId: ex.exerciseId }),
      onHistory: (ex) => {
        const doc = docOf(ex.logExerciseId);
        const lines = doc ? historyLines(doc, ex.lastTime, units) : [];
        const when = lastRef.current[ex.exerciseId]?.finishedAt;
        setInfo({
          title: `Last time · ${ex.name}`,
          lines:
            lines.length > 0
              ? [...(when ? [new Date(when).toDateString()] : []), ...lines]
              : ['No history yet. Your numbers will show here next time.'],
          testID: 'history-sheet',
        });
      },
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
    }),
    [tableFor, op, withPick, docOf, units],
  );

  /** Mark all: asks first when it ticks more than one set, and says which get no weight and which it leaves. */
  const markAllNow = (logExerciseIds: string[], pickOf: string | null) => {
    Keyboard.dismiss();
    const picked = pickOf ? withPick(pickOf)(log) : log;
    const plan = markAllPlan(picked, logExerciseIds, last);
    const run = () =>
      void markDone((l) => markAll(pickOf ? withPick(pickOf)(l) : l, logExerciseIds, lastRef.current, nowIso())).then(
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
    const lastMain = [...ex.sets].reverse().find((s) => s.setType !== 'drop');
    const items: MenuItem[] = [
      { title: ex.note ? 'Edit note' : 'Add note', testID: 'menu-note', onPress: () => setNoteFor(ex) },
      { title: 'How to do it', testID: 'menu-info', onPress: () => setInfoFor({ name: ex.exerciseName, exerciseId: ex.exerciseId }) },
      { title: 'Swap exercise', testID: 'menu-swap', onPress: () => setPicker({ mode: 'swap', ex }) },
    ];
    if (lastMain) {
      items.push({
        title: 'Add a drop set',
        testID: 'menu-add-drop',
        onPress: () => void op((l) => addLogDrop(withPick(ex.id)(l), ex.id, lastMain.id, randomUUID, nowIso())),
      });
    }
    const deletable = deleteChoices(ex, units, last[ex.exerciseId]?.sets ?? []);
    if (deletable.length > 0) {
      items.push({
        title: 'Delete a set',
        testID: 'menu-delete-a-set',
        onPress: () =>
          setSetMenu({
            title: `Delete which set? · ${ex.exerciseName}`,
            items: deletable.map((c, i) => ({
              title: c.title,
              testID: `menu-delete-set-${i}`,
              onPress: () => void op((l) => removeLogSet(l, ex.id, c.setId, nowIso())),
            })),
          }),
      });
    }
    items.push({ title: 'Remove exercise', testID: 'menu-remove-exercise', onPress: () => confirmRemoveExercise(ex) });
    return items;
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
  const discardNow = () => void discard().then(back);
  const confirmDiscard = () =>
    Alert.alert('Discard this workout?', 'Your ticked sets won’t be saved.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: discardNow },
    ]);
  const saved = readFinishNotes(log.notes);
  const finishNow = async (feel: Feeling | null, note: string) => {
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
    <>
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
      <KeyboardBar />
      <FinishSheet
        visible={finishOpen}
        model={finishModel(log)}
        initialFeel={saved.feel}
        initialNote={saved.note}
        busy={finishing}
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
    </>
  );

  const pill = syncLate ? (
    <View pointerEvents="none" style={styles.syncPill}>
      <SyncPill status={syncStatus} />
    </View>
  ) : null;

  if (screen.mode === 'overview') {
    const at = resumePlace(log, sections);
    return (
      <View style={styles.fill}>
        <WorkoutOverview
          name={log.name}
          started={completedSetCount(log) > 0}
          sections={sections.map((section) => ({ section, groups: startGroups(log, section, units) }))}
          equipment={equipment}
          details={details}
          onStart={() =>
            completedSetCount(log) > 0 && at ? setScreen({ mode: 'pages', ...at }) : setScreen({ mode: 'start', section: at?.section ?? 0 })
          }
          onSection={(i) => setScreen({ mode: 'start', section: i })}
          onClose={back}
          onInfo={(item) => setInfoFor({ name: item.name, exerciseId: item.exerciseId })}
          onAddExercise={() => setPicker({ mode: 'add' })}
          onFinish={() => setFinishOpen(true)}
          onDiscard={confirmDiscard}
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
          onStart={() => {
            const at = resumePlace(log, [section]);
            setScreen({ mode: 'pages', section: sectionIndex, page: at?.page ?? 0 });
          }}
          onBack={() => setScreen({ mode: 'overview' })}
          onInfo={(item) => setInfoFor({ name: item.name, exerciseId: item.exerciseId })}
          onAddExercise={() => setPicker({ mode: 'add' })}
        />
        {pill}
        {sheets}
      </SafeAreaView>
    );
  }

  const pageIndex = Math.min(screen.page, section.pages.length - 1);
  const here = { section: sectionIndex, page: pageIndex };
  // Moving never needs Done: ‹ and › step a page (into the next or previous section too), a swipe past the
  // section's first or last page goes on into the next section, and the title opens the list of sections.
  const go = (to: { section: number; page: number } | null) => to && setScreen({ mode: 'pages', ...to });
  const prevSection = stepPlace(sections, { section: sectionIndex, page: 0 }, -1);
  const nextSection = stepPlace(sections, { section: sectionIndex, page: section.pages.length - 1 }, 1);
  return (
    <View style={styles.fill}>
      <SectionPages
        key={section.key}
        log={log}
        section={section}
        sectionIndex={sectionIndex}
        sectionCount={sections.length}
        page={pageIndex}
        units={units}
        last={last}
        details={details}
        handlers={handlers}
        steps={{ prev: stepLabel(sections, here, -1), next: stepLabel(sections, here, 1) }}
        edges={{
          prev: prevSection ? sections[prevSection.section].title : null,
          next: nextSection ? sections[nextSection.section].title : null,
        }}
        onPage={(page) => setScreen({ mode: 'pages', section: sectionIndex, page })}
        onStep={(delta) => go(stepPlace(sections, here, delta))}
        onEdge={(delta) => go(delta < 0 ? prevSection : nextSection)}
        onSections={() => setScreen({ mode: 'overview' })}
        onClose={() => setScreen({ mode: 'start', section: sectionIndex })}
        onMarkAll={markAllNow}
        onDone={(page) => {
          const next = afterDone(sections, { section: sectionIndex, page });
          if (next.kind === 'page') setScreen({ mode: 'pages', section: sectionIndex, page: next.page });
          else if (next.kind === 'section') setScreen({ mode: 'start', section: next.section });
          else setFinishOpen(true);
        }}
      />
      {pill}
      {sheets}
    </View>
  );
}

/** A section's pages, swiped left and right, with Mark all, Done and the dots fixed under them. */
function SectionPages({
  log,
  section,
  sectionIndex,
  sectionCount,
  page,
  units,
  last,
  details,
  handlers,
  steps,
  edges,
  onPage,
  onStep,
  onEdge,
  onSections,
  onClose,
  onMarkAll,
  onDone,
}: {
  log: WorkoutLogDoc;
  section: FlowSection;
  sectionIndex: number;
  sectionCount: number;
  page: number;
  units: Units;
  last: LastResults;
  details: Parameters<typeof StraightPage>[0]['details'];
  handlers: PageHandlers;
  /** What ‹ and › say ("Next page", "Previous section: Warm-Up"); null at either end of the workout. */
  steps: { prev: string | null; next: string | null };
  /** The section a swipe past the first or last page goes on to (its title), or null. */
  edges: { prev: string | null; next: string | null };
  onPage: (page: number) => void;
  onStep: (delta: -1 | 1) => void;
  onEdge: (delta: -1 | 1) => void;
  /** The title: the workout overview, which lists every section. */
  onSections: () => void;
  onClose: () => void;
  /** Ticks every open set of these exercises; `pickOf` is the option a pick-one page picks first. */
  onMarkAll: (logExerciseIds: string[], pickOf: string | null) => void;
  onDone: (page: number) => void;
}) {
  const { text, space, radius } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<FlowPage>>(null);
  const shown = useRef(page);
  const initial = useRef(page).current;
  /** A swipe-through page before the first page when there is a section before this one (and one after the last). */
  const lead = edges.prev ? 1 : 0;

  const models = useMemo(() => section.pages.map((p) => buildPage(log, p, units, last)), [log, section, units, last]);

  // A page chosen from outside (a dot, Done, a change to the log): scroll there.
  useEffect(() => {
    if (shown.current === page) return;
    shown.current = page;
    listRef.current?.scrollToOffset({ offset: (page + lead) * width, animated: true });
  }, [page, width, lead]);

  // VoiceOver: each page that comes on screen (swiped, a dot, Done) is read from its heading.
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

  const dots = pageDots(log, section, page);
  /** Mark all for a page, or null when there is nothing to mark (all ticked, or an option locked out). */
  const markFor = (m: PageModel): (() => void) | null => {
    if (m.allDone || (m.kind === 'option' && m.lockedOut !== null)) return null;
    const ids = m.kind === 'superset' ? m.exercises.map((e) => e.logExerciseId) : [m.exercise.logExerciseId];
    return () => onMarkAll(ids, m.kind === 'option' ? m.exercise.logExerciseId : null);
  };
  const what = (p: FlowPage) => (p.kind === 'superset' ? 'Superset' : p.kind === 'option' ? 'Option' : 'Exercise');

  return (
    <View style={[styles.fill, styles.ink]}>
      <View style={[styles.header, { paddingTop: insets.top + space[1], paddingHorizontal: space[4], paddingBottom: space[3] }]}>
        <Pressable
          testID="close-section"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${section.title}. The workout keeps going.`}
          style={({ pressed }) => [styles.headerButton, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[text('screenTitle'), styles.onInk]}>✕</Text>
        </Pressable>
        <Pressable
          testID="pages-title"
          onPress={onSections}
          accessibilityRole="button"
          accessibilityLabel={section.title}
          accessibilityHint="Shows every section, to jump to any of them."
          style={({ pressed }) => [styles.headerTitle, pressed && { opacity: pressedOpacity }]}
        >
          <Text style={[text('sectionHeading'), styles.onInk, styles.centre]} numberOfLines={2} maxFontSizeMultiplier={1.6}>
            {section.title}
          </Text>
          <Text testID="pages-sections" style={[text('caption'), styles.onInk, styles.centre]} maxFontSizeMultiplier={1.6}>
            {sectionCount > 1 ? `Section ${sectionIndex + 1} of ${sectionCount} · All sections ▾` : 'Overview ▾'}
          </Text>
        </Pressable>
        <View style={styles.headerButton} />
      </View>
      <View style={[styles.sheet, { borderTopLeftRadius: radius.card + 4, borderTopRightRadius: radius.card + 4 }]}>
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
            const pageProps = (i: number) => ({ page: i, units, details, handlers, headingRef: refFor[i] ?? null });
            const m = models[index];
            return (
              <ScrollView
                testID={`page-${index}`}
                style={{ width }}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={[styles.pageContent, { padding: space[4], paddingBottom: space[6] }]}
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
              </ScrollView>
            );
          }}
        />
        <View style={[styles.footer, { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: insets.bottom + space[2], gap: space[2] }]}>
          <Pressable
            testID="page-done"
            onPress={() => onDone(page)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.done, { borderRadius: radius.pill }, pressed && { opacity: pressedOpacity }]}
          >
            <Text style={[text('button'), styles.onInk]}>Done</Text>
          </Pressable>
          <View style={styles.stepRow}>
            <StepButton testID="page-prev" glyph="‹" label={steps.prev} onPress={() => onStep(-1)} />
            {dots.length > MAX_DOTS ? (
              <Text testID="page-count" style={text('sectionHeading')} accessibilityLabel={`${what(section.pages[page])} ${page + 1} of ${dots.length}. Swipe left and right.`}>
                {`${page + 1} / ${dots.length}`}
              </Text>
            ) : dots.length > 1 ? (
              <View style={styles.dots} accessibilityRole="tablist">
                {dots.map((d, i) => (
                  <Pressable
                    key={section.pages[i].key}
                    testID={`dot-${i}`}
                    onPress={() => onPage(i)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: d === 'current' }}
                    accessibilityLabel={`${what(section.pages[i])} ${i + 1} of ${dots.length}${d === 'done' ? ', done' : ''}. Or swipe left and right.`}
                    style={styles.dotTarget}
                  >
                    <View style={[styles.dot, d === 'current' ? styles.dotCurrent : d === 'done' ? styles.dotDone : styles.dotTodo]} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <StepButton testID="page-next" glyph="›" label={steps.next} onPress={() => onStep(1)} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** ‹ or › beside the dots: one page back or forward, into the next or previous section too. Dimmed at the ends. */
function StepButton({ testID, glyph, label, onPress }: { testID: string; glyph: string; label: string | null; onPress: () => void }) {
  const { text } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={label === null}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label ?? (glyph === '‹' ? 'Previous page' : 'Next page')}
      accessibilityState={{ disabled: label === null }}
      style={({ pressed }) => [styles.dotTarget, label === null && styles.stepOff, pressed && { opacity: pressedOpacity }]}
    >
      <Text style={text('screenTitle')}>{glyph}</Text>
    </Pressable>
  );
}

/** Past a section's first or last page: the section a swipe goes on to. Landing here opens it. */
function EdgePage({ width, dir, title }: { width: number; dir: -1 | 1; title: string }) {
  const { text, space } = useTheme();
  return (
    <View testID={dir < 0 ? 'edge-prev' : 'edge-next'} style={[styles.edge, { width, padding: space[4], gap: space[2] }]}>
      <Text style={[text('caption'), styles.centre]}>{dir < 0 ? '‹ Previous section' : 'Next section ›'}</Text>
      <Text style={[text('screenTitle'), styles.centre]}>{title}</Text>
    </View>
  );
}

const DOT = 8;
/** Past this many pages the dots (with ‹ and › beside them) no longer fit a phone's width: "3 / 12" instead. */
const MAX_DOTS = 6;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: palette.bg },
  ink: { backgroundColor: palette.ink },
  onInk: { color: white },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: tapTarget.min, minHeight: tapTarget.min, justifyContent: 'center' },
  headerTitle: { flex: 1, alignItems: 'center', minHeight: tapTarget.min, justifyContent: 'center' },
  centre: { textAlign: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.25 },
  edge: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: { flex: 1, backgroundColor: palette.bg, overflow: 'hidden' },
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
  dots: { flexDirection: 'row', justifyContent: 'center' },
  dotTarget: { width: tapTarget.min, height: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  dotCurrent: { backgroundColor: palette.ink, width: DOT * 2.5 },
  dotDone: { backgroundColor: palette.lime, borderWidth: 1, borderColor: palette.ink },
  dotTodo: { backgroundColor: palette.border },
  syncPill: { position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' },
});
