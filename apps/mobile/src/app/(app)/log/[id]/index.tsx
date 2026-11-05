import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { tapTarget } from '@caltracker/design-tokens';
import {
  addLogDrop,
  addLogExercise,
  addLogSet,
  completeSet,
  formatClock,
  formatLastResult,
  removeLogExercise,
  removeLogSet,
  setExerciseNote,
  swapLogExercise,
  uncompleteSet,
  updateActual,
  type ExercisePick,
  type LogExerciseDoc,
  type LogSetDoc,
} from '@caltracker/shared';
import { ActionMenu, type MenuItem } from '@/components/log/action-menu';
import { ExercisePicker } from '@/components/log/exercise-picker';
import { LogBlock, type BlockHandlers } from '@/components/log/log-block';
import { NoteSheet } from '@/components/log/note-sheet';
import { RestSheet } from '@/components/log/rest-sheet';
import { SyncPill } from '@/components/log/sync-pill';
import { Button, Card, Screen, TextButton } from '@/components/ui';
import { fetchLastResults, type LastResults } from '@/lib/log-api';
import { cancelRestEnd, restOverHaptic, scheduleReminder, scheduleRestEnd, tapHaptic } from '@/lib/log-notifications';
import { useActiveLog } from '@/lib/use-active-log';
import { useUnits } from '@/lib/use-units';
import { supersetLetters } from '@/lib/workouts';
import { palette } from '@/theme/theme';
import { useTheme } from '@/theme/use-theme';

type Menu =
  | { kind: 'log' }
  | { kind: 'exercise'; ex: LogExerciseDoc }
  | { kind: 'set'; ex: LogExerciseDoc; set: LogSetDoc; label: string };

type Picker = { mode: 'add' } | { mode: 'swap'; ex: LogExerciseDoc };

/** Room under the list so the rest sheet never covers the last set. */
const REST_SHEET_SPACE = 200;

const nowIso = () => new Date().toISOString();

/** Seconds since `startIso`, ticking once a second. */
function useElapsed(startIso: string | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return startIso ? Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000)) : 0;
}

/** The workout being logged: tick sets, edit what was actually done, rest between sets. */
export default function LogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { text, space, radius } = useTheme();
  const { log: active, ready, syncStatus, op, finish, discard } = useActiveLog();
  const units = useUnits();
  const log = active && active.id === id ? active : null;

  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [noteFor, setNoteFor] = useState<LogExerciseDoc | null>(null);
  const [last, setLast] = useState<LastResults>({});
  const elapsed = useElapsed(log?.startedAt);

  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/today')), [router]);

  // "Last time" for every exercise in the log; reloaded only when the set of exercises changes.
  const exerciseKey = useMemo(
    () => [...new Set(log?.blocks.flatMap((b) => b.exercises.map((e) => e.exerciseId)) ?? [])].sort().join(','),
    [log],
  );
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

  const startRest = (seconds: number) => {
    setRestEndsAt(Date.now() + seconds * 1000);
    scheduleRestEnd(seconds);
  };
  const adjustRest = (delta: number) => {
    setRestEndsAt((end) => {
      if (end === null) return end;
      const next = Math.max(Date.now() + 1000, end + delta * 1000);
      scheduleRestEnd((next - Date.now()) / 1000);
      return next;
    });
  };
  const skipRest = () => {
    cancelRestEnd();
    setRestEndsAt(null);
  };
  const restDone = useCallback(() => {
    restOverHaptic(); // the scheduled notification plays the sound
    setRestEndsAt(null);
  }, []);

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

  const handlers: BlockHandlers = {
    onTick: (_ex, set) => {
      if (set.completedAt !== null) {
        void op((l) => uncompleteSet(l, set.id, nowIso()));
        return;
      }
      tapHaptic();
      void op((l) => completeSet(l, set.id, nowIso()));
      scheduleReminder(log.name, log.id);
      const rest = set.target.restSeconds ?? 0;
      if (rest > 0) startRest(rest);
    },
    onChange: (set, patch) => void op((l) => updateActual(l, set.id, patch)),
    onSetMenu: (ex, set, label) => setMenu({ kind: 'set', ex, set, label }),
    onExerciseMenu: (ex) => setMenu({ kind: 'exercise', ex }),
    onAddSet: (ex) => void op((l) => addLogSet(l, ex.id, randomUUID, nowIso())),
  };

  const confirmDiscard = () =>
    Alert.alert('Discard this workout?', 'Your ticked sets won’t be saved.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          skipRest();
          void discard().then(back);
        },
      },
    ]);

  const doFinish = async () => {
    // Task 9 adds the "sets not done" confirmation and the summary screen; until then Finish returns to Today.
    if (await finish()) {
      skipRest();
      back();
    } else {
      Alert.alert('Complete at least one set to finish.');
    }
  };

  const confirmRemoveExercise = (ex: LogExerciseDoc) =>
    Alert.alert(`Remove ${ex.exerciseName}?`, 'Its sets are removed from this workout.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void op((l) => removeLogExercise(l, ex.id, nowIso())) },
    ]);

  const menuTitle = menu === null ? null : menu.kind === 'log' ? log.name : menu.kind === 'exercise' ? menu.ex.exerciseName : `${menu.ex.exerciseName} · ${menu.set.setType === 'drop' ? 'drop set' : menu.label === 'W' ? 'warm-up' : `set ${menu.label}`}`;
  const menuItems: MenuItem[] = (() => {
    if (menu === null) return [];
    if (menu.kind === 'log') {
      return [
        { title: 'Finish workout', testID: 'finish-button', variant: 'finish', onPress: () => void doFinish() },
        { title: 'Discard workout', testID: 'discard-button', onPress: confirmDiscard },
      ];
    }
    if (menu.kind === 'exercise') {
      const ex = menu.ex;
      return [
        { title: 'Swap exercise', testID: 'menu-swap', onPress: () => setPicker({ mode: 'swap', ex }) },
        { title: ex.note ? 'Edit note' : 'Add note', testID: 'menu-note', onPress: () => setNoteFor(ex) },
        { title: 'Remove exercise', testID: 'menu-remove-exercise', onPress: () => confirmRemoveExercise(ex) },
      ];
    }
    const { ex, set } = menu;
    const items: MenuItem[] = [];
    if (set.setType !== 'drop') {
      items.push({
        title: '+ Drop',
        testID: 'menu-add-drop',
        onPress: () => void op((l) => addLogDrop(l, ex.id, set.id, randomUUID, nowIso())),
      });
    }
    items.push({ title: 'Remove set', testID: 'menu-remove-set', onPress: () => void op((l) => removeLogSet(l, ex.id, set.id, nowIso())) });
    return items;
  })();

  const pick = (choice: ExercisePick) => {
    const p = picker;
    setPicker(null);
    if (p?.mode === 'swap') void op((l) => swapLogExercise(l, p.ex.id, choice, nowIso()));
    else void op((l) => addLogExercise(l, choice, randomUUID, nowIso()));
  };

  const letters = supersetLetters(log.blocks);
  let exerciseIndex = 0;

  return (
    <View style={styles.fill}>
      <Screen>
        <View style={[styles.headerRow, { gap: space[2] }]}>
          <TextButton testID="back" title="Today" onPress={back} />
          <SyncPill status={syncStatus} />
          <View style={styles.fill} />
          <Pressable
            testID="log-menu"
            onPress={() => setMenu({ kind: 'log' })}
            accessibilityRole="button"
            accessibilityLabel="Workout options: finish or discard"
            style={({ pressed }) => [styles.headerMenu, { borderRadius: radius.pill }, pressed && styles.pressed]}
          >
            <Text style={text('sectionHeading')}>•••</Text>
          </Pressable>
        </View>

        <View style={{ gap: space[1] }}>
          <Text style={text('screenTitle')} accessibilityRole="header">
            {log.name}
          </Text>
          <Text
            testID="log-timer"
            style={text('bigNumber')}
            accessibilityLabel={`${Math.floor(elapsed / 60)} minutes in`}
          >
            {formatClock(elapsed)}
          </Text>
        </View>

        {log.blocks.length === 0 ? (
          <Card>
            <Text style={text('body')}>Add your first exercise to start logging.</Text>
          </Card>
        ) : null}

        {log.blocks.map((block, i) => {
          const first = exerciseIndex;
          exerciseIndex += block.exercises.length;
          return (
            <LogBlock
              key={block.id}
              block={block}
              letter={letters[i] ?? null}
              firstExerciseIndex={first}
              units={units}
              lastTime={(ex) => formatLastResult(last[ex.exerciseId]?.sets ?? [], ex.trackingType, units)}
              handlers={handlers}
            />
          );
        })}

        <Button variant="secondary" title="+ Exercise" testID="add-exercise" onPress={() => setPicker({ mode: 'add' })} />
        <Button variant="finish" title="Finish workout" testID="finish-workout" onPress={() => void doFinish()} />

        {restEndsAt !== null ? <View style={{ height: REST_SHEET_SPACE }} /> : null}
      </Screen>

      {restEndsAt !== null ? (
        <RestSheet endsAt={restEndsAt} onAdjust={adjustRest} onSkip={skipRest} onDone={restDone} />
      ) : null}

      <ActionMenu title={menuTitle} items={menuItems} onClose={() => setMenu(null)} />
      <ExercisePicker
        title={picker?.mode === 'swap' ? `Swap ${picker.ex.exerciseName}` : 'Add an exercise'}
        visible={picker !== null}
        onPick={pick}
        onClose={() => setPicker(null)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerMenu: { minWidth: tapTarget.min, minHeight: tapTarget.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: palette.surface },
});
