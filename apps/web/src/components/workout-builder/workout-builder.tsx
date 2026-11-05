'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  WorkoutDoc,
  addDrop,
  addExerciseToSuperset,
  addRound,
  addSet,
  addStraightBlock,
  addSuperset,
  moveBlock,
  removeBlock,
  removeExercise,
  removeRound,
  removeSet,
  replaceExercise,
  updateSet,
} from '@caltracker/shared';
import type { ExercisePick, IsoDate, Units } from '@caltracker/shared';
import { saveWorkout, type SaveIssue } from '@/app/(coach)/workouts/actions';
import { ReloadButton } from '@/components/reload-button';
import { SAVED_CHIP_MS, SaveStatus } from '@/components/save-status';
import { Button, ErrorText, TextAreaField, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { BlockEditor, type BlockActions } from './block-editor';
import { ExercisePicker } from './exercise-picker';
import styles from './builder.module.css';

export type BuilderMode = 'library' | { clientName: string; date: IsoDate };

type Props = {
  initial: WorkoutDoc;
  units: Units;
  mode: BuilderMode;
  /** Called after each successful save. Without it, a new library workout moves to /workouts/[id]. */
  onSaved?: (id: string) => void;
  /** True when `initial` has never been saved (it shows no "Saved" status yet). */
  isNew?: boolean;
};

type Picker =
  | { kind: 'straight' }
  | { kind: 'superset' }
  | { kind: 'addToSuperset'; blockId: string }
  | { kind: 'swap'; blockId: string; exId: string; name: string };

const makeId = () => crypto.randomUUID();

/**
 * A new library workout moves to /workouts/[id] after its first save, which mounts a fresh builder. This remembers
 * that save (in this browser tab only) so the new page still shows "✓ Saved" for the rest of its few seconds.
 */
let lastNewSave: { id: string; at: number } | null = null;

/**
 * Turns schema issue paths (indexes into the saved doc) into keys by row id, so a message stays on its row even if
 * blocks move afterwards. Unknown paths go under 'general'.
 */
function issuesByKey(doc: WorkoutDoc, issues: readonly SaveIssue[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (key: string, message: string) => {
    const list = out.get(key) ?? [];
    if (!list.includes(message)) out.set(key, [...list, message]);
  };
  for (const { path, message } of issues) {
    const [top, bi, , ei, , si] = path;
    if (top === 'name' || top === 'notes') {
      add(top, message);
      continue;
    }
    const block = typeof bi === 'number' ? doc.blocks[bi] : undefined;
    if (top !== 'blocks' || !block) {
      add(top === 'blocks' ? 'blocks' : 'general', message);
      continue;
    }
    const ex = typeof ei === 'number' ? block.exercises[ei] : undefined;
    const set = ex && typeof si === 'number' ? ex.sets[si] : undefined;
    if (set) add(`set:${set.id}`, message);
    else if (ex) add(`exercise:${ex.id}`, message);
    else add(`block:${block.id}`, message);
  }
  return out;
}

const formatDay = (date: IsoDate) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );

export function WorkoutBuilder({ initial, units, mode, onSaved, isNew = false }: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<WorkoutDoc>(initial);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial));
  const [everSaved, setEverSaved] = useState(!isNew);
  const [savedAt, setSavedAt] = useState<number | null>(() =>
    lastNewSave?.id === initial.id && Date.now() - lastNewSave.at < SAVED_CHIP_MS ? lastNewSave.at : null,
  );
  const [errors, setErrors] = useState<Map<string, string[]>>(new Map());
  const [formError, setFormError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = useMemo(() => JSON.stringify(doc) !== savedJson, [doc, savedJson]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function save() {
    setFormError(null);
    const parsed = WorkoutDoc.safeParse(doc);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        message: i.message,
      }));
      setErrors(issuesByKey(doc, issues));
      setFormError('Check the highlighted fields.');
      return;
    }
    const snapshot = doc;
    startTransition(async () => {
      let outcome: Awaited<ReturnType<typeof saveWorkout>>;
      try {
        outcome = await saveWorkout(parsed.data);
      } catch (e) {
        setFormError(failureMessage(e, "Couldn't save. Check your connection and try again."));
        return;
      }
      if (!outcome.ok) {
        setErrors(issuesByKey(snapshot, outcome.issues ?? []));
        setFormError(outcome.error);
        return;
      }
      setErrors(new Map());
      // Keep any edits made while saving; they still count as unsaved.
      setSavedJson(JSON.stringify(parsed.data));
      setDoc((cur) => (cur === snapshot ? parsed.data : cur));
      setEverSaved(true);
      const at = Date.now();
      setSavedAt(at);
      if (onSaved) onSaved(outcome.id);
      else if (mode === 'library' && isNew) {
        lastNewSave = { id: outcome.id, at };
        router.replace(`/workouts/${outcome.id}`);
      }
    });
  }

  function onPick(exs: ExercisePick[]) {
    const p = picker;
    setPicker(null);
    const [ex] = exs;
    if (!p || !ex) return;
    setDoc((d) => {
      switch (p.kind) {
        case 'straight':
          return addStraightBlock(d, ex, makeId);
        case 'superset':
          return exs.length >= 2 ? addSuperset(d, exs, makeId) : d;
        case 'addToSuperset':
          return addExerciseToSuperset(d, p.blockId, ex, makeId);
        case 'swap':
          return replaceExercise(d, p.blockId, p.exId, ex);
      }
    });
  }

  const actionsFor = (blockId: string, index: number): BlockActions => ({
    onMove: (delta) => setDoc((d) => moveBlock(d, blockId, index + delta)),
    onRemoveBlock: () => setDoc((d) => removeBlock(d, blockId)),
    onAddRound: () => setDoc((d) => addRound(d, blockId, makeId)),
    onRemoveRound: () => setDoc((d) => removeRound(d, blockId)),
    onAddExercise: () => setPicker({ kind: 'addToSuperset', blockId }),
    onSwap: (exId) => {
      const name = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === exId)?.exerciseName ?? '';
      setPicker({ kind: 'swap', blockId, exId, name });
    },
    onRemoveExercise: (exId) => setDoc((d) => removeExercise(d, blockId, exId)),
    // No doc-op for exercise notes: it is a plain field with no rules to keep.
    onExerciseNote: (exId, note) =>
      setDoc((d) => ({
        ...d,
        blocks: d.blocks.map((b) =>
          b.id !== blockId ? b : { ...b, exercises: b.exercises.map((e) => (e.id === exId ? { ...e, note } : e)) },
        ),
      })),
    onAddSet: (exId) => setDoc((d) => addSet(d, blockId, exId, makeId)),
    onAddDrop: (exId, setId) => setDoc((d) => addDrop(d, blockId, exId, setId, makeId)),
    onRemoveSet: (exId, setId) => setDoc((d) => removeSet(d, blockId, exId, setId)),
    onUpdateSet: (exId, setId, patch) => setDoc((d) => updateSet(d, blockId, exId, setId, patch)),
  });

  const pickerTitle =
    picker?.kind === 'straight'
      ? 'Add an exercise'
      : picker?.kind === 'superset'
        ? 'Add a superset / circuit'
        : picker?.kind === 'addToSuperset'
          ? 'Add an exercise to the superset'
          : picker?.kind === 'swap'
            ? `Swap ${picker.name}`
            : '';

  return (
    <div className={styles.builder}>
      {mode !== 'library' ? (
        <p className={styles.modeBanner}>
          {mode.clientName}&apos;s workout for {formatDay(mode.date)}. Changes here don&apos;t touch your library.
        </p>
      ) : null}

      <div className={styles.details}>
        <TextField
          label="Workout name"
          maxLength={100}
          value={doc.name}
          {...(errors.has('name') ? { error: errors.get('name')![0]! } : {})}
          onChange={(e) => setDoc((d) => ({ ...d, name: e.target.value }))}
        />
        <TextAreaField
          label="Workout notes (optional)"
          maxLength={2000}
          rows={2}
          value={doc.notes ?? ''}
          onChange={(e) => setDoc((d) => ({ ...d, notes: e.target.value === '' ? null : e.target.value }))}
        />
        {(errors.get('notes') ?? []).map((m) => (
          <ErrorText key={m}>{m}</ErrorText>
        ))}
      </div>

      <div className={styles.blocks}>
        {doc.blocks.map((b, i) => (
          <BlockEditor
            key={b.id}
            block={b}
            index={i}
            count={doc.blocks.length}
            units={units}
            errors={errors}
            actions={actionsFor(b.id, i)}
          />
        ))}
        {doc.blocks.length === 0 ? <p className={styles.caption}>No exercises yet.</p> : null}
        {(errors.get('blocks') ?? []).map((m) => (
          <ErrorText key={m}>{m}</ErrorText>
        ))}
      </div>

      <div className={styles.addRow}>
        <Button variant="secondary" onClick={() => setPicker({ kind: 'straight' })}>
          + Exercise
        </Button>
        <Button variant="secondary" onClick={() => setPicker({ kind: 'superset' })}>
          + Superset / circuit
        </Button>
      </div>

      <div className={styles.saveBar}>
        {(errors.get('general') ?? []).map((m) => (
          <ErrorText key={m}>{m}</ErrorText>
        ))}
        {formError ? <ErrorText>{formError}</ErrorText> : null}
        {formError === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
        <SaveStatus pending={pending} dirty={dirty} everSaved={everSaved} savedAt={savedAt} />
        <Button onClick={save} pending={pending}>
          {pending ? 'Saving…' : 'Save workout'}
        </Button>
      </div>

      {picker ? (
        <ExercisePicker
          title={pickerTitle}
          multiple={picker.kind === 'superset'}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
