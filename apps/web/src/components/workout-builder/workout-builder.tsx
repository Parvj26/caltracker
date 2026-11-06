'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  WorkoutDoc,
  addChoice,
  addChoiceOption,
  addDrop,
  addExerciseToSuperset,
  addRound,
  addSection,
  addSet,
  addStraightBlock,
  addSuperset,
  moveBlock,
  moveBlockToSection,
  moveSection,
  removeBlock,
  removeExercise,
  removeRound,
  removeSection,
  renameSection,
  removeSet,
  replaceExercise,
  sectionRuns,
  updateSet,
  addSubstitute,
  addSubstituteDrop,
  addSubstituteSet,
  removeSubstitute,
  removeSubstituteSet,
  updateSubstitute,
  updateSubstituteSet,
} from '@caltracker/shared';
import type { ExercisePick, IsoDate, Units } from '@caltracker/shared';
import { invalidateExerciseIndex } from '@/lib/exercise-index';
import { saveWorkout, type SaveIssue } from '@/app/(coach)/workouts/actions';
import { ReloadButton } from '@/components/reload-button';
import { SAVED_CHIP_MS, SaveStatus } from '@/components/save-status';
import { Button, ErrorText, TextAreaField, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { AddSectionMenu } from './add-section-menu';
import { SectionHeader } from './section-header';
import { BlockEditor, type BlockActions } from './block-editor';
import { ExercisePicker } from './exercise-picker';
import styles from './builder.module.css';

export type BuilderMode = 'library' | { clientName: string; date: IsoDate };

type Props = {
  initial: WorkoutDoc;
  units: Units;
  /** The coach's workspace (from requireCoach), for the exercise picker. */
  workspaceId: string;
  mode: BuilderMode;
  /** Called after each successful save. Without it, a new library workout moves to /workouts/[id]. */
  onSaved?: (id: string) => void;
  /** True when `initial` has never been saved (it shows no "Saved" status yet). */
  isNew?: boolean;
};

type Picker =
  | { kind: 'straight' }
  | { kind: 'superset' }
  | { kind: 'choice' }
  | { kind: 'addOption'; blockId: string }
  | { kind: 'addToSuperset'; blockId: string }
  | { kind: 'swap'; blockId: string; exId: string; name: string }
  | { kind: 'substitute'; blockId: string; exId: string; name: string };

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
    if (top === 'sections') {
      const section = typeof bi === 'number' ? doc.sections[bi] : undefined;
      add(section ? `section:${section.id}` : 'general', message);
      continue;
    }
    const block = typeof bi === 'number' ? doc.blocks[bi] : undefined;
    if (top !== 'blocks' || !block) {
      add(top === 'blocks' ? 'blocks' : 'general', message);
      continue;
    }
    const ex = typeof ei === 'number' ? block.exercises[ei] : undefined;
    if (ex && path[4] === 'substitutes') {
      // ['blocks', bi, 'exercises', ei, 'substitutes', subIndex, 'sets', setIndex, ...]
      const sub = typeof path[5] === 'number' ? ex.substitutes[path[5]] : undefined;
      const subSet = sub && typeof path[7] === 'number' ? sub.sets[path[7]] : undefined;
      if (subSet) add(`set:${subSet.id}`, message);
      else if (sub) add(`substitute:${sub.id}`, message);
      else add(`exercise:${ex.id}`, message);
      continue;
    }
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

export function WorkoutBuilder({ initial, units, workspaceId, mode, onSaved, isNew = false }: Props) {
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
      // A saved workout changes the coach's "recently used" list.
      if (outcome.ok) invalidateExerciseIndex();
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
        case 'choice':
          return exs.length >= MIN_CHOICE_OPTIONS ? addChoice(d, exs, makeId) : d;
        case 'addOption':
          return addChoiceOption(d, p.blockId, ex, makeId);
        case 'addToSuperset':
          return addExerciseToSuperset(d, p.blockId, ex, makeId);
        case 'swap':
          return replaceExercise(d, p.blockId, p.exId, ex);
        case 'substitute':
          return addSubstitute(d, p.blockId, p.exId, ex, makeId);
      }
    });
  }

  const actionsFor = (blockId: string, index: number): BlockActions => ({
    onAddOption: () => setPicker({ kind: 'addOption', blockId }),
    onMoveToSection: (sectionId) => setDoc((d) => moveBlockToSection(d, blockId, sectionId)),
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
    onAddSubstitute: (exId) => {
      const name = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === exId)?.exerciseName ?? '';
      setPicker({ kind: 'substitute', blockId, exId, name });
    },
    substitute: (exId, subId) => ({
      onRemove: () => setDoc((d) => removeSubstitute(d, blockId, exId, subId)),
      onNote: (note) => setDoc((d) => updateSubstitute(d, blockId, exId, subId, { note })),
      onAddSet: () => setDoc((d) => addSubstituteSet(d, blockId, exId, subId, makeId)),
      onAddDrop: (setId) => setDoc((d) => addSubstituteDrop(d, blockId, exId, subId, setId, makeId)),
      onRemoveSet: (setId) => setDoc((d) => removeSubstituteSet(d, blockId, exId, subId, setId)),
      onUpdateSet: (setId, patch) => setDoc((d) => updateSubstituteSet(d, blockId, exId, subId, setId, patch)),
    }),
  });

  // Headings and blocks in order. A section with no exercises yet still shows its heading, where it belongs.
  const items = useMemo(() => {
    type Item =
      | { kind: 'section'; section: { id: string; name: string }; empty: boolean }
      | { kind: 'block'; block: WorkoutDoc['blocks'][number]; index: number; canMoveUp: boolean; canMoveDown: boolean };
    const out: Item[] = [];
    const shown = new Set<string>();
    const showEmptyThrough = (upTo: number) => {
      doc.sections.forEach((sec, i) => {
        if (i < upTo && !shown.has(sec.id) && !doc.blocks.some((b) => b.sectionId === sec.id)) {
          shown.add(sec.id);
          out.push({ kind: 'section', section: sec, empty: true });
        }
      });
    };
    for (const run of sectionRuns(doc.blocks, doc.sections)) {
      if (run.section) {
        showEmptyThrough(doc.sections.findIndex((x) => x.id === run.section!.id));
        shown.add(run.section.id);
        out.push({ kind: 'section', section: run.section, empty: false });
      }
      run.blockIndexes.forEach((bi, k) =>
        out.push({
          kind: 'block',
          block: doc.blocks[bi]!,
          index: bi,
          canMoveUp: k > 0,
          canMoveDown: k < run.blockIndexes.length - 1,
        }),
      );
    }
    showEmptyThrough(doc.sections.length);
    return out;
  }, [doc.blocks, doc.sections]);

  const pickerTitle =
    picker?.kind === 'straight'
      ? 'Add an exercise'
      : picker?.kind === 'superset'
        ? 'Add a superset / circuit'
        : picker?.kind === 'addToSuperset'
          ? 'Add an exercise to the superset'
          : picker?.kind === 'swap'
            ? `Swap ${picker.name}`
            : picker?.kind === 'substitute'
              ? `Add a substitute for ${picker.name}`
            : picker?.kind === 'choice'
              ? 'Add a pick-one group'
              : picker?.kind === 'addOption'
                ? 'Add an option to the pick-one group'
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
        {items.map((item) =>
          item.kind === 'section' ? (
            <SectionHeader
              key={`section-${item.section.id}`}
              section={item.section}
              index={doc.sections.findIndex((x) => x.id === item.section.id)}
              count={doc.sections.length}
              empty={item.empty}
              errors={errors.get(`section:${item.section.id}`) ?? []}
              onRename={(name) => setDoc((d) => renameSection(d, item.section.id, name))}
              onMove={(delta) => setDoc((d) => moveSection(d, item.section.id, delta))}
              onRemove={() => setDoc((d) => removeSection(d, item.section.id))}
            />
          ) : (
            <BlockEditor
              key={item.block.id}
              block={item.block}
              index={item.index}
              canMoveUp={item.canMoveUp}
              canMoveDown={item.canMoveDown}
              sections={doc.sections}
              units={units}
              errors={errors}
              actions={actionsFor(item.block.id, item.index)}
            />
          ),
        )}
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
        <Button variant="secondary" onClick={() => setPicker({ kind: 'choice' })}>
          + Pick one
        </Button>
        <AddSectionMenu full={doc.sections.length >= 10} onAdd={(name) => setDoc((d) => addSection(d, name, makeId))} />
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
          workspaceId={workspaceId}
          multiple={picker.kind === 'superset' || picker.kind === 'choice'}
          {...(picker.kind === 'choice'
            ? { min: MIN_CHOICE_OPTIONS, max: MAX_CHOICE_OPTIONS, hint: 'Pick 2 to 5 exercises. The client does just one of them.', groupLabel: 'pick-one group' }
            : {})}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
