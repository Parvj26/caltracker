'use client';

import type { ErrorCode } from '@caltracker/shared';
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  BUILDER_SETS,
  MAX_BLOCKS,
  MAX_CHOICE_OPTIONS,
  MIN_CHOICE_OPTIONS,
  WorkoutDoc,
  addChoice,
  addChoiceOption,
  addSection,
  addSet,
  addStraightBlocks,
  blockCollapsedSummary,
  canJoinWithNext,
  exerciseCollapsedLine,
  exerciseRestOff,
  joinWithNext,
  keepRestOff,
  moveBlock,
  moveBlockToSection,
  moveSection,
  removeBlock,
  removeExercise,
  removeSection,
  reorderBlocks,
  rememberRests,
  restoreRests,
  setExerciseRest,
  splitSuperset,
  renameSection,
  removeSet,
  replaceExercise,
  sectionRuns,
  updateSet,
  addSubstitute,
  addSubstituteSet,
  removeSubstitute,
  removeSubstituteSet,
  updateSubstitute,
  updateSubstituteSet,
  withSingleReps,
  toggleExerciseMeasurement,
  updateExerciseOptions,
  applyExercisePrefs,
} from '@caltracker/shared';
import type { ExercisePick, ExercisePrefs, IsoDate, RestMemory, Units } from '@caltracker/shared';
import { invalidateExerciseIndex } from '@/lib/exercise-index';
import { exercisePrefs, saveWorkout, type SaveIssue, type SaveWorkoutOutcome } from '@/app/(coach)/workouts/actions';
import { ReloadButton } from '@/components/reload-button';
import { SAVED_CHIP_MS, SaveStatus } from '@/components/save-status';
import { Button, ErrorText, notAContact, TextAreaField, TextField } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import { AddSectionMenu } from './add-section-menu';
import { SectionHeader } from './section-header';
import { BlockEditor, restState, type BlockActions } from './block-editor';
import { ExercisePicker } from './exercise-picker';
import { Icon } from './icons';
import { MoreSheet, PhoneExerciseEditor, PhoneLink, PhoneRow, phoneCardHasErrors, type Card } from './phone-builder';
import { ReorderDialog, type ReorderRun } from './reorder-dialog';
import { SupersetSwitch } from './superset-switch';
import { useKeyboardOffset } from './use-keyboard-offset';
import styles from './builder.module.css';

export type BuilderMode = 'library' | { clientName: string; date: IsoDate };

type Props = {
  initial: WorkoutDoc;
  units: Units;
  /** The coach's workspace (from requireCoach), for the exercise picker. */
  workspaceId: string;
  mode: BuilderMode;
  /**
   * Saves instead of saveWorkout (the program builder asks where an edit goes first). Resolving null means the coach
   * went back to editing: nothing was saved and nothing is shown.
   */
  saveWith?: (doc: WorkoutDoc) => Promise<SaveWorkoutOutcome | null>;
  /** The save button's words (default "Save workout"). */
  saveLabel?: string;
  /** Told when the workout gains or loses unsaved changes. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called after each successful save. Without it, a new library workout moves to /workouts/[id]. */
  onSaved?: (id: string) => void;
  /** True when `initial` has never been saved (it shows no "Saved" status yet). */
  isNew?: boolean;
  /** The workspace's remembered measurements and Each side per exercise (loadExercisePrefs). */
  initialPrefs?: Record<string, ExercisePrefs>;
};

type Picker =
  | { kind: 'straight' }
  | { kind: 'choice' }
  | { kind: 'addOption'; blockId: string }
  | { kind: 'swap'; blockId: string; exId: string; name: string }
  | { kind: 'substitute'; blockId: string; exId: string; name: string; exclude: string[] };

const makeId = () => crypto.randomUUID();
const NO_PREFS: Record<string, ExercisePrefs> = {};
/** The most exercises "+ Exercise" adds in one go (a workout holds up to 30 blocks). */
const STRAIGHT_PICK_MAX = 10;

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
    if (ex && path[4] === 'tempo') {
      add(`tempo:${ex.id}`, message);
      continue;
    }
    const set = ex && typeof si === 'number' ? ex.sets[si] : undefined;
    if (set) add(`set:${set.id}`, message);
    else if (ex) add(`exercise:${ex.id}`, message);
    else add(`block:${block.id}`, message);
  }
  return out;
}

/** A block's name in "Move to…": the exercise, or the group's exercises. */
function blockTitle(block: WorkoutDoc['blocks'][number]): string {
  const names = block.exercises.map((e) => e.exerciseName);
  if (block.kind === 'superset') return `Superset: ${names.join(' + ')}`;
  if (block.kind === 'choice') return `Pick one: ${names.join(' or ')}`;
  return names[0] ?? '';
}

/** The exercises whose Rest checkbox reads as off (every rest they show is 0), when the builder opens. */
function restOffIn(doc: WorkoutDoc): Set<string> {
  return new Set(doc.blocks.flatMap((b) => b.exercises.flatMap((e, ei) => (exerciseRestOff(b, ei) === true ? [e.id] : []))));
}

/** Superset badges: A, B, … then AA, AB, … past 26 (a workout holds at most 30 blocks). */
const letter = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : `${letter(Math.floor(n / 26) - 1)}${letter(n % 26)}`);

const formatDay = (date: IsoDate) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(`${date}T00:00:00Z`),
  );

export function WorkoutBuilder({
  initial,
  units,
  workspaceId,
  mode,
  onSaved,
  isNew = false,
  initialPrefs = NO_PREFS,
  saveWith,
  saveLabel = 'Save workout',
  onDirtyChange,
}: Props) {
  const router = useRouter();
  // One rep count per set: an older range (10–12) shows, and saves, as its top number. Not an unsaved change by itself.
  const [doc, setDoc] = useState<WorkoutDoc>(() => withSingleReps(initial));
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(withSingleReps(initial)));
  const [everSaved, setEverSaved] = useState(!isNew);
  const [savedAt, setSavedAt] = useState<number | null>(() =>
    lastNewSave?.id === initial.id && Date.now() - lastNewSave.at < SAVED_CHIP_MS ? lastNewSave.at : null,
  );
  const [errors, setErrors] = useState<Map<string, string[]>>(new Map());
  const [formError, setFormError] = useState<ErrorCode | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  // iPad portrait folds every card to one line and opens one at a time (wider screens ignore this). A card is a
  // block, or one exercise of a superset (keyed by the exercise's id).
  const [openId, setOpenId] = useState<string | null>(null);
  // iPhone: the card open in the full-screen exercise editor.
  const [editing, setEditing] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Exercises whose Rest checkbox is off. Not in the saved workout: it reads back from the rests (all 0).
  const [restOff, setRestOff] = useState<ReadonlySet<string>>(() => restOffIn(initial));
  /** Every edit goes through here, so an exercise whose Rest is off never gains a rest (a split or a new set). */
  const change = (fn: (d: WorkoutDoc) => WorkoutDoc, off: ReadonlySet<string> = restOff) => setDoc((d) => keepRestOff(fn(d), off));
  // True from a pick in "+ Exercise" or "+ Pick one" until the new block shows (a split also makes a block).
  const adding = useRef(false);
  const knownBlocks = useRef<Set<string>>(new Set(initial.blocks.map((b) => b.id)));
  const [pending, startTransition] = useTransition();
  const saveBarRef = useRef<HTMLDivElement>(null);
  useKeyboardOffset(saveBarRef);
  const dirty = useMemo(() => JSON.stringify(doc) !== savedJson, [doc, savedJson]);
  // The workspace's remembered choices per exercise: read with the page, then again after each save. A ref, not
  // state: the picker may hold an onPick from an earlier render.
  const prefs = useRef<Record<string, ExercisePrefs>>(initialPrefs);
  const [prefsVersion, setPrefsVersion] = useState(0);
  useEffect(() => {
    if (prefsVersion === 0) return;
    let live = true;
    void exercisePrefs()
      .then((p) => {
        if (live) prefs.current = p;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prefsVersion]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // A newly added exercise (or group) opens, so the coach can fill it in straight away, and scrolls into view.
  const builderRef = useRef<HTMLDivElement>(null);
  const scrollToId = useRef<string | null>(null);
  useEffect(() => {
    const added = doc.blocks.find((b) => !knownBlocks.current.has(b.id));
    knownBlocks.current = new Set(doc.blocks.map((b) => b.id));
    if (added && adding.current) {
      adding.current = false;
      scrollToId.current = added.id;
      setOpenId(added.id);
    }
  }, [doc.blocks]);
  useEffect(() => {
    const id = scrollToId.current;
    if (id === null || id !== openId) return;
    scrollToId.current = null;
    // The card, or on an iPhone its row (the other layout is hidden).
    const el = [...(builderRef.current?.querySelectorAll(`[data-card-id="${CSS.escape(id)}"]`) ?? [])].find(
      (x) => x.getClientRects().length > 0,
    );
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Phones and iPad portrait: the exercise's top just under the top Save bar (scroll-margin-top). Wider screens
    // only scroll when it is out of sight.
    const narrow = window.matchMedia('(max-width: 899.98px)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: narrow ? 'start' : 'nearest' });
  }, [openId]);

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
      setFormError('workout_fields_invalid');
      return;
    }
    const snapshot = doc;
    startTransition(async () => {
      let outcome: SaveWorkoutOutcome | null;
      try {
        outcome = await (saveWith ?? saveWorkout)(parsed.data);
      } catch (e) {
        setFormError(failureCode(e, 'save_offline'));
        return;
      }
      if (outcome === null) return;
      // A saved workout changes the coach's "recently used" list.
      if (outcome.ok) {
        invalidateExerciseIndex();
        setPrefsVersion((v) => v + 1);
      }
      if (!outcome.ok) {
        setErrors(issuesByKey(snapshot, outcome.issues ?? []));
        setFormError(outcome.code);
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


  function onPick(picked: ExercisePick[]) {
    const p = picker;
    setPicker(null);
    adding.current = p?.kind === 'straight' || p?.kind === 'choice';
    // Each exercise starts with the measurements and Each side this workspace last saved it with (not a substitute,
    // which keeps its own kind).
    const exs = p?.kind === 'substitute' ? picked : picked.map((x) => applyExercisePrefs(x, prefs.current[x.id]));
    const [ex] = exs;
    if (!p || !ex) return;
    change((d) => {
      switch (p.kind) {
        case 'straight':
          // Several picks: each becomes its own straight block, in the order they were picked.
          return addStraightBlocks(d, exs, makeId, BUILDER_SETS);
        case 'choice':
          return exs.length >= MIN_CHOICE_OPTIONS ? addChoice(d, exs, makeId, BUILDER_SETS) : d;
        case 'addOption':
          return addChoiceOption(d, p.blockId, ex, makeId, BUILDER_SETS);
        case 'swap':
          return replaceExercise(d, p.blockId, p.exId, ex);
        case 'substitute':
          return addSubstitute(d, p.blockId, p.exId, ex, makeId);
      }
    });
  }

  // The rests a Superset switch changed when it went on, so turning it off again gives them back (see restoreRests).
  const joinedRests = useRef<RestMemory>({});

  /**
   * A Superset switch. Exercises that move to another block get new ids, so the Rest checkboxes follow them by place
   * (a join or split never changes the order of the exercises).
   */
  function toggleLink(op: (d: WorkoutDoc) => WorkoutDoc, splitting: boolean) {
    let next = op(doc);
    if (splitting) next = restoreRests(doc, next, joinedRests.current);
    else joinedRests.current = { ...joinedRests.current, ...rememberRests(doc, next) };
    const ids = (d: WorkoutDoc) => d.blocks.flatMap((b) => b.exercises.map((e) => e.id));
    const before = ids(doc);
    const after = ids(next);
    const off = new Set(after.filter((_, i) => restOff.has(before[i]!)));
    setRestOff(off);
    setDoc(keepRestOff(next, off));
  }

  const actionsFor = (blockId: string): BlockActions => ({
    onAddOption: () => setPicker({ kind: 'addOption', blockId }),
    onMoveToSection: (sectionId) => change((d) => moveBlockToSection(d, blockId, sectionId)),
    onRemoveBlock: () => change((d) => removeBlock(d, blockId)),
    onSwap: (exId) => {
      const name = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === exId)?.exerciseName ?? '';
      setPicker({ kind: 'swap', blockId, exId, name });
    },
    onRemoveExercise: (exId) => change((d) => removeExercise(d, blockId, exId)),
    // No doc-op for exercise notes: it is a plain field with no rules to keep.
    onExerciseNote: (exId, note) =>
      change((d) => ({
        ...d,
        blocks: d.blocks.map((b) =>
          b.id !== blockId ? b : { ...b, exercises: b.exercises.map((e) => (e.id === exId ? { ...e, note } : e)) },
        ),
      })),
    onAddSet: (exId) => change((d) => addSet(d, blockId, exId, makeId)),
    onRemoveSet: (exId, setId) => change((d) => removeSet(d, blockId, exId, setId)),
    onUpdateSet: (exId, setId, patch) => change((d) => updateSet(d, blockId, exId, setId, patch)),
    onToggleMeasurement: (exId, m) => change((d) => toggleExerciseMeasurement(d, blockId, exId, m)),
    onToggleRest: (exId, on) => {
      const next = new Set(restOff);
      if (on) next.delete(exId);
      else next.add(exId);
      setRestOff(next);
      change((d) => setExerciseRest(d, blockId, exId, on), next);
    },
    onExerciseOptions: (exId, patch) => change((d) => updateExerciseOptions(d, blockId, exId, patch)),
    onAddSubstitute: (exId) => {
      const ex = doc.blocks.find((b) => b.id === blockId)?.exercises.find((e) => e.id === exId);
      // The planned exercise and its substitutes can't be picked again (addSubstitute would refuse them).
      const exclude = ex ? [ex.exerciseId, ...ex.substitutes.map((s) => s.exerciseId)] : [];
      setPicker({ kind: 'substitute', blockId, exId, name: ex?.exerciseName ?? '', exclude });
    },
    substitute: (exId, subId) => ({
      onRemove: () => change((d) => removeSubstitute(d, blockId, exId, subId)),
      onNote: (note) => change((d) => updateSubstitute(d, blockId, exId, subId, { note })),
      onAddSet: () => change((d) => addSubstituteSet(d, blockId, exId, subId, makeId)),
      onRemoveSet: (setId) => change((d) => removeSubstituteSet(d, blockId, exId, subId, setId)),
      onUpdateSet: (setId, patch) => change((d) => updateSubstituteSet(d, blockId, exId, subId, setId, patch)),
    }),
  });

  // Headings and cards in order. A section with no exercises yet still shows its heading, where it belongs. A
  // superset is one card per exercise; between two cards of one section sits the Superset switch (not next to a
  // pick-one group). Exercises and pick-one groups are numbered 1, 2, 3…; supersets lettered A1, A2, B1…
  const { items, cards, runs } = useMemo(() => {
    type Siblings = Array<{ id: string; index: number; title: string }>;
    type Item =
      | { kind: 'section'; section: { id: string; name: string }; empty: boolean }
      | { kind: 'card'; card: Card; index: number; siblings: Siblings };
    const out: Item[] = [];
    const flat: Card[] = [];
    const reorder: ReorderRun[] = [];
    const shown = new Set<string>();
    const showEmptyThrough = (upTo: number) => {
      doc.sections.forEach((sec, i) => {
        if (i < upTo && !shown.has(sec.id) && !doc.blocks.some((b) => b.sectionId === sec.id)) {
          shown.add(sec.id);
          out.push({ kind: 'section', section: sec, empty: true });
        }
      });
    };
    const badges = new Map<string, string>();
    let number = 0;
    let letters = 0;
    for (const b of doc.blocks) {
      if (b.kind === 'superset') badges.set(b.id, letter(letters++));
      else badges.set(b.id, String(++number));
    }
    const blockCards = (b: WorkoutDoc['blocks'][number]): Card[] => {
      if (b.kind === 'superset') {
        return b.exercises.map((e, ei) => ({
          key: e.id,
          block: b,
          member: ei,
          badge: `${badges.get(b.id)}${ei + 1}`,
          title: e.exerciseName,
          line: exerciseCollapsedLine(e, units, { rest: restState(b, ei, restOff) === true }),
          link: null,
        }));
      }
      if (b.kind === 'choice') {
        const sum = blockCollapsedSummary(b, units);
        return [{ key: b.id, block: b, badge: badges.get(b.id)!, title: b.exercises.map((e) => e.exerciseName).join(' or '), line: `${sum.title} · ${sum.line}`, link: null }];
      }
      const e = b.exercises[0]!;
      return [{ key: b.id, block: b, badge: badges.get(b.id)!, title: e.exerciseName, line: exerciseCollapsedLine(e, units, { rest: restState(b, 0, restOff) === true }), link: null }];
    };
    for (const run of sectionRuns(doc.blocks, doc.sections)) {
      if (run.section) {
        showEmptyThrough(doc.sections.findIndex((x) => x.id === run.section!.id));
        shown.add(run.section.id);
        out.push({ kind: 'section', section: run.section, empty: false });
      }
      const siblings = run.blockIndexes.map((bi) => ({ id: doc.blocks[bi]!.id, index: bi, title: blockTitle(doc.blocks[bi]!) }));
      reorder.push({
        key: run.section?.id ?? 'none',
        section: run.section?.name ?? null,
        items: run.blockIndexes.map((bi) => {
          const b = doc.blocks[bi]!;
          return {
            id: b.id,
            tag: b.kind === 'superset' ? `Superset ${badges.get(b.id)}` : b.kind === 'choice' ? 'Pick one' : null,
            names: b.exercises.map((e) => e.exerciseName),
          };
        }),
      });
      const runCards = run.blockIndexes.flatMap((bi) => blockCards(doc.blocks[bi]!).map((card) => ({ card, index: bi })));
      runCards.forEach(({ card, index }, k) => {
        const next = runCards[k + 1]?.card;
        if (next && card.block.kind !== 'choice' && next.block.kind !== 'choice') {
          const together = next.block.id === card.block.id;
          const blockId = card.block.id;
          card.link = {
            on: together,
            label: `Superset ${card.title} with ${next.title}`,
            blocked: together
              ? doc.blocks.length >= MAX_BLOCKS
                ? `A workout holds at most ${MAX_BLOCKS} exercises and groups.`
                : null
              : canJoinWithNext(doc, blockId)
                ? null
                : 'A superset has at most 10 exercises.',
            onToggle: () => toggleLink(together ? (d) => splitSuperset(d, blockId, next.member!, makeId) : (d) => joinWithNext(d, blockId, makeId), together),
          };
        }
        flat.push(card);
        out.push({ kind: 'card', card, index, siblings });
      });
    }
    showEmptyThrough(doc.sections.length);
    return { items: out, cards: flat, runs: reorder };
    // `change` is new each render but only reads restOff, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, units, restOff]);

  // A workout holds at most 30 blocks, so "+ Exercise" offers only the room that is left (and at most 10 at once).
  const room = MAX_BLOCKS - doc.blocks.length;
  const straightMax = Math.max(1, Math.min(STRAIGHT_PICK_MAX, room));
  const full = room <= 0;
  const fullNote = `A workout holds at most ${MAX_BLOCKS} exercises and groups. Remove one to add another.`;
  const sectionsFull = doc.sections.length >= 10;
  const addSectionNamed = (name: string) => change((d) => addSection(d, name, makeId));

  const pickerTitle =
    picker?.kind === 'straight'
      ? 'Add exercises'
      : picker?.kind === 'swap'
        ? `Swap ${picker.name}`
        : picker?.kind === 'substitute'
          ? `Add a substitute for ${picker.name}`
          : picker?.kind === 'choice'
            ? 'Add a pick-one group'
            : picker?.kind === 'addOption'
              ? 'Add an option to the pick-one group'
              : '';

  const editingAt = editing === null ? -1 : cards.findIndex((c) => c.key === editing);
  const editingItem = editingAt >= 0 ? items.find((it) => it.kind === 'card' && it.card.key === editing) : undefined;

  const sectionHeader = (item: Extract<(typeof items)[number], { kind: 'section' }>) => (
    <SectionHeader
      key={`section-${item.section.id}`}
      section={item.section}
      index={doc.sections.findIndex((x) => x.id === item.section.id)}
      count={doc.sections.length}
      empty={item.empty}
      errors={errors.get(`section:${item.section.id}`) ?? []}
      onRename={(name) => change((d) => renameSection(d, item.section.id, name))}
      onMove={(delta) => change((d) => moveSection(d, item.section.id, delta))}
      onRemove={() => change((d) => removeSection(d, item.section.id))}
    />
  );
  const blockErrors = (errors.get('blocks') ?? []).map((m) => (
    <ErrorText key={m} code="workout_fields_invalid" safe={false}>
      {m}
    </ErrorText>
  ));

  return (
    // data-no-menu-button: on an iPhone the tab bar would sit on the builder's own bottom bar (More, + Exercise).
    <div ref={builderRef} className={styles.builder} data-no-menu-button="">
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
          // A workout's name, not a person's: no contact AutoFill (see notAContact), autocorrect or spell-check underlines.
          {...notAContact('workout-title')}
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          {...(errors.has('name') ? { error: { code: 'field_format', text: errors.get('name')![0]! } } : {})}
          onChange={(e) => {
            const name = e.target.value;
            change((d) => ({ ...d, name }));
            // "Enter a name." goes as soon as the name is valid again, not at the next save.
            if (errors.has('name') && WorkoutDoc.in.shape.name.safeParse(name).success) {
              setErrors((cur) => {
                const next = new Map(cur);
                next.delete('name');
                return next;
              });
            }
          }}
        />
        <TextAreaField
          label="Workout notes (optional)"
          maxLength={2000}
          rows={2}
          value={doc.notes ?? ''}
          onChange={(e) => change((d) => ({ ...d, notes: e.target.value === '' ? null : e.target.value }))}
        />
        {(errors.get('notes') ?? []).map((m) => (
          <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
        ))}
      </div>

      {/* iPad and desktop: the cards, with a Superset switch between two exercises. */}
      <div className={cx(styles.blocks, styles.wideList)}>
        {items.map((item) =>
          item.kind === 'section' ? (
            sectionHeader(item)
          ) : (
            <Fragment key={item.card.key}>
              <BlockEditor
                block={item.card.block}
                {...(item.card.member !== undefined ? { member: item.card.member } : {})}
                badge={item.card.badge}
                sections={doc.sections}
                units={units}
                errors={errors}
                actions={actionsFor(item.card.block.id)}
                restOff={restOff}
                open={openId === item.card.key}
                onToggle={() => setOpenId((cur) => (cur === item.card.key ? null : item.card.key))}
                siblings={item.siblings}
                onMoveTo={(to) => change((d) => moveBlock(d, item.card.block.id, to))}
              />
              {item.card.link ? <SupersetSwitch link={item.card.link} variant="switch" /> : null}
            </Fragment>
          ),
        )}
        {doc.blocks.length === 0 ? <p className={styles.caption}>No exercises yet.</p> : null}
        {blockErrors}
      </div>

      {/* iPhone: one row per exercise, a link icon between two; a tap opens the exercise on its own screen. */}
      <div className={styles.phoneList}>
        {doc.blocks.length > 0 ? (
          <p className={styles.caption}>
            {cards.length} {cards.length === 1 ? 'exercise' : 'exercises'} · tap the link icon to superset two
          </p>
        ) : (
          <p className={styles.caption}>No exercises yet.</p>
        )}
        {items.map((item) =>
          item.kind === 'section' ? (
            sectionHeader(item)
          ) : (
            <Fragment key={item.card.key}>
              <PhoneRow card={item.card} hasErrors={phoneCardHasErrors(item.card, errors)} onOpen={() => setEditing(item.card.key)} />
              {item.card.link ? <PhoneLink link={item.card.link} /> : null}
            </Fragment>
          ),
        )}
        {blockErrors}
      </div>

      {/* The top bar: on iPad and desktop the tools, "+ Exercise" and Save; on an iPhone the workout's name and Save
          (its tools sit in the bottom bar). */}
      <div ref={saveBarRef} className={styles.saveBar}>
        <span className={styles.barName}>{doc.name.trim() || 'New workout'}</span>
        <SaveStatus pending={pending} dirty={dirty} everSaved={everSaved} savedAt={savedAt} />
        <span className={styles.barTools}>
          <Button variant="secondary" className={styles.toolButton} disabled={doc.blocks.length < 2} onClick={() => setReordering(true)} data-ph-capture-attribute-label="workout_reorder">
            <Icon name="reorder" size={18} />
            Reorder
          </Button>
          <Button variant="secondary" className={styles.toolButton} disabled={full} onClick={() => setPicker({ kind: 'choice' })} data-ph-capture-attribute-label="workout_add_pick_one" data-ph-safe="">
            + Pick one
          </Button>
          <AddSectionMenu full={sectionsFull} popover onAdd={addSectionNamed} />
        </span>
        <Button
          variant="secondary"
          className={cx(styles.addExercise, styles.barAdd)}
          disabled={full}
          onClick={() => setPicker({ kind: 'straight' })}
          data-ph-capture-attribute-label="workout_add_exercise"
          data-ph-safe=""
        >
          + Exercise
        </Button>
        <Button
          onClick={save}
          pending={pending}
          className={styles.saveButton}
          aria-label={pending ? undefined : saveLabel}
          data-ph-capture-attribute-label="workout_save"
        >
          {pending ? (
            'Saving…'
          ) : saveLabel === 'Save workout' ? (
            // The bar says just "Save" (the name stays "Save workout").
            <span>Save</span>
          ) : (
            saveLabel
          )}
        </Button>
        {(errors.get('general') ?? []).map((m) => (
          <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
        ))}
        {formError ? <ErrorText code={formError} /> : null}
        {formError === 'stale_deploy' ? <ReloadButton className={styles.smallButton} /> : null}
        {full ? <p className={styles.caption}>{fullNote}</p> : null}
      </div>

      <div className={styles.phoneBar}>
        <button type="button" className={styles.moreButtonBig} aria-haspopup="dialog" onClick={() => setMoreOpen(true)} data-ph-capture-attribute-label="workout_more">
          <Icon name="dots" size={20} />
          More
        </button>
        <Button
          variant="secondary"
          className={styles.addExercise}
          disabled={full}
          onClick={() => setPicker({ kind: 'straight' })}
          data-ph-capture-attribute-label="workout_add_exercise_phone"
          data-ph-safe=""
        >
          + Exercise
        </Button>
      </div>

      {moreOpen ? (
        <MoreSheet
          full={full}
          sectionsFull={sectionsFull}
          onReorder={() => {
            setMoreOpen(false);
            setReordering(true);
          }}
          onPickOne={() => {
            setMoreOpen(false);
            setPicker({ kind: 'choice' });
          }}
          onAddSection={addSectionNamed}
          onClose={() => setMoreOpen(false)}
        />
      ) : null}

      {editingItem?.kind === 'card' ? (
        <PhoneExerciseEditor
          card={editingItem.card}
          place={editingAt}
          count={cards.length}
          onGo={(delta) => setEditing(cards[editingAt + delta]?.key ?? editing)}
          onClose={() => setEditing(null)}
          units={units}
          errors={errors}
          actions={actionsFor(editingItem.card.block.id)}
          restOff={restOff}
          places={editingItem.siblings.map((s) => ({
            key: s.id,
            label: s.title,
            current: s.id === editingItem.card.block.id,
            onSelect: () => change((d) => moveBlock(d, editingItem.card.block.id, s.index)),
          }))}
          sectionTargets={[
            ...(editingItem.card.block.sectionId !== null ? [{ id: 'none', name: 'No section' }] : []),
            ...doc.sections.filter((sec) => sec.id !== editingItem.card.block.sectionId),
          ].map((t) => ({
            key: t.id,
            label: t.name,
            onSelect: () => change((d) => moveBlockToSection(d, editingItem.card.block.id, t.id === 'none' ? null : t.id)),
          }))}
        />
      ) : null}

      {reordering ? (
        <ReorderDialog runs={runs} onDone={(ids) => change((d) => reorderBlocks(d, ids))} onClose={() => setReordering(false)} />
      ) : null}

      {picker ? (
        <ExercisePicker
          title={pickerTitle}
          workspaceId={workspaceId}
          {...(picker.kind === 'substitute' ? { exclude: picker.exclude } : {})}
          multiple={picker.kind === 'straight' || picker.kind === 'choice'}
          {...(picker.kind === 'straight'
            ? {
                min: 1,
                max: straightMax,
                hint:
                  room < STRAIGHT_PICK_MAX
                    ? `Tap each exercise you want, in order. This workout has room for ${room} more (${MAX_BLOCKS} at most).`
                    : 'Tap each exercise you want. Each one is added on its own, in the order you pick them.',
                groupLabel: 'workout',
                footerNote: 'Each exercise is added with 1 set. Use + Set to add more; it copies the last one.',
              }
            : {})}
          {...(picker.kind === 'choice'
            ? {
                min: MIN_CHOICE_OPTIONS,
                max: MAX_CHOICE_OPTIONS,
                hint: 'Pick 2 to 5 exercises. The client does just one of them.',
                groupLabel: 'pick-one group',
                footerNote: 'Each option is added with 1 set. Use + Set to add more.',
              }
            : {})}
          onPick={onPick}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
