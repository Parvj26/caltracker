'use client';

import { useId, useState } from 'react';
import {
  MAX_CHOICE_OPTIONS,
  MAX_SUBSTITUTES,
  TEMPO_PLACEHOLDER,
  blockCollapsedSummary,
  exerciseCollapsedLine,
  parseTempo,
  setShowsRest,
} from '@caltracker/shared';
import type { Measurement, Units, WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { BlockMenu, MoveToDialog, type MenuItem } from './block-menu';
import { Icon, type IconName } from './icons';
import { MeasurementsMenu } from './measurements-menu';
import { type SetPatch } from './set-row';
import { SetTable } from './set-table';
import { SubstituteEditor, type SubstituteActions } from './substitute-editor';
import styles from './builder.module.css';

/**
 * Row names for screen readers and tests: "set 1", "set 2", ... by place. Every row counts, warm-ups and drops too,
 * matching the number shown on the row and the "Remove set N" button.
 */
export function rowNames(sets: readonly WorkoutSetDoc[]): string[] {
  return sets.map((_, i) => `set ${i + 1}`);
}

/** A 48 px icon-only button; `label` is its name for screen readers and its tooltip. */
export function IconButton({
  icon,
  label,
  title = label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.iconButton} aria-label={label} title={title} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** The exercise's name as a button that opens the swap picker: dashed underline and a small chevron. */
export function SwapName({ name, nameId, onSwap }: { name: string; nameId?: string; onSwap: () => void }) {
  return (
    <button type="button" className={styles.swapName} aria-label={`Swap exercise: ${name}`} title="Tap to swap exercise" onClick={onSwap}>
      <span id={nameId}>{name}</span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

export type BlockActions = {
  onRemoveBlock: () => void;
  onAddOption: () => void;
  onMoveToSection: (sectionId: string | null) => void;
  onSwap: (exId: string) => void;
  onRemoveExercise: (exId: string) => void;
  onExerciseNote: (exId: string, note: string | null) => void;
  /** "+ Set": a copy of the exercise's last set (see addSet in packages/shared). */
  onAddSet: (exId: string) => void;
  onRemoveSet: (exId: string, setId: string) => void;
  onUpdateSet: (exId: string, setId: string, patch: SetPatch) => void;
  /** The measurements tab: one of Weight / Reps / Time on or off (see toggleExerciseMeasurement). */
  onToggleMeasurement: (exId: string, m: Measurement) => void;
  /** The Rest checkbox (see setExerciseRest). */
  onToggleRest: (exId: string, on: boolean) => void;
  /** Each side and Tempo, above "+ Set". */
  onExerciseOptions: (exId: string, patch: { eachSide?: boolean; tempo?: string | null }) => void;
  onAddSubstitute: (exId: string) => void;
  substitute: (exId: string, substituteId: string) => SubstituteActions;
};

type Props = {
  block: WorkoutBlockDoc;
  /**
   * A superset shows each exercise as a card of its own, joined by the Superset switches: the exercise this card
   * is. Omitted for a straight exercise or a pick-one group (one card).
   */
  member?: number;
  /** The badge: "3" for an exercise or pick-one group, "A1" for a superset's first exercise. */
  badge: string;
  /** The workout's sections, to offer "Move to section…" (omitted or empty: no menu). */
  sections: ReadonlyArray<{ id: string; name: string }>;
  units: Units;
  /** Inline errors keyed by `block:<id>`, `exercise:<id>`, `tempo:<exercise id>` and `set:<id>`. */
  errors: ReadonlyMap<string, string[]>;
  actions: BlockActions;
  /** Exercises whose Rest checkbox is off (no rest boxes). */
  restOff: ReadonlySet<string>;
  /**
   * iPad portrait (600 to 900 px) folds each card to one line; `open` unfolds it (one at a time, see
   * WorkoutBuilder) and `onToggle` is a tap on the folded line. Wider screens always show every card in full.
   */
  open?: boolean;
  onToggle?: () => void;
  /** The blocks in this block's section, in order (this one included), for "Move to top" and "Move to…". */
  siblings?: ReadonlyArray<{ id: string; index: number; title: string }>;
  /** Moves this block to a place in the doc (moveBlock keeps it inside its section). */
  onMoveTo?: (index: number) => void;
};

/** The messages from the last save on these exercises (their substitutes and sets), and on the block itself. */
export function cardHasErrors(block: WorkoutBlockDoc, exercises: readonly WorkoutExerciseDoc[], errors: ReadonlyMap<string, string[]>, withBlock: boolean): boolean {
  if (errors.size === 0) return false;
  const keys = withBlock ? [`block:${block.id}`] : [];
  for (const ex of exercises) {
    keys.push(`exercise:${ex.id}`, `tempo:${ex.id}`, ...ex.sets.map((s) => `set:${s.id}`));
    for (const sub of ex.substitutes) keys.push(`substitute:${sub.id}`, ...sub.sets.map((s) => `set:${s.id}`));
  }
  return keys.some((k) => (errors.get(k)?.length ?? 0) > 0);
}

/** Per set: whether its rest box shows (the superset rule, and not when the exercise's Rest is off). */
export const restShownFor = (block: WorkoutBlockDoc, ei: number, restOff: ReadonlySet<string>): boolean[] => {
  const ex = block.exercises[ei]!;
  return ex.sets.map((_, si) => !restOff.has(ex.id) && setShowsRest(block, ei, si));
};

/** The Rest checkbox's state: null when no set of the exercise shows a rest (see exerciseRestOff). */
export const restState = (block: WorkoutBlockDoc, ei: number, restOff: ReadonlySet<string>): boolean | null =>
  block.exercises[ei]!.sets.some((s, si) => s.setType !== 'drop' && setShowsRest(block, ei, si)) ? !restOff.has(block.exercises[ei]!.id) : null;

export function BlockEditor({
  block,
  member,
  badge,
  sections,
  units,
  errors,
  actions,
  restOff,
  open = false,
  onToggle,
  siblings = [],
  onMoveTo,
}: Props) {
  const headingId = useId();
  const bodyId = useId();
  const noteId = useId();
  const [moving, setMoving] = useState(false);
  const inSuperset = member !== undefined;
  const choice = block.kind === 'choice' && !inSuperset;
  const shown = inSuperset ? [{ ex: block.exercises[member]!, ei: member }] : block.exercises.map((ex, ei) => ({ ex, ei }));
  const first = shown[0]!.ex;
  const shortTitle = choice ? `pick-one group ${badge}` : first.exerciseName;
  // Under a section's (hidden) <h2>, a card's title is an <h3> and a pick-one group's exercises <h4>, so heading
  // navigation shows which cards belong to which section. Cards outside any section keep <h2> / <h3>.
  const inSection = block.sectionId !== null && sections.some((sec) => sec.id === block.sectionId);
  const TitleTag = inSection ? 'h3' : 'h2';
  const ExerciseTag = inSection ? 'h4' : 'h3';
  const targets = [
    ...(block.sectionId !== null ? [{ id: 'none', name: 'No section' }] : []),
    ...sections.filter((sec) => sec.id !== block.sectionId),
  ];
  const summary = inSuperset
    ? { title: first.exerciseName, line: exerciseCollapsedLine(first, units, { rest: restState(block, member, restOff) === true }), parts: [] }
    : blockCollapsedSummary(block, units);
  const hasErrors = cardHasErrors(block, shown.map((x) => x.ex), errors, !inSuperset || member === 0);
  // A card with a message from the last save stays open, so the coach can see what to fix.
  const unfolded = open || hasErrors;
  const place = siblings.findIndex((s) => s.id === block.id);
  const focusNote = () => {
    if (!unfolded) onToggle?.();
    // After the card has unfolded.
    requestAnimationFrame(() => setTimeout(() => document.getElementById(noteId)?.focus(), 0));
  };
  const remove = inSuperset ? () => actions.onRemoveExercise(first.id) : actions.onRemoveBlock;
  const menuItems: MenuItem[] = [
    ...(!inSuperset ? [{ label: 'Move to top', disabled: place <= 0, onSelect: () => onMoveTo?.(siblings[0]!.index) }] : []),
    { label: inSuperset ? 'Move superset to…' : 'Move to…', disabled: siblings.length < 2 && targets.length === 0, onSelect: () => setMoving(true) },
    ...(!choice ? [{ label: 'Swap exercise', onSelect: () => actions.onSwap(first.id) }] : []),
    ...(!choice
      ? [
          {
            label: 'Add substitute',
            disabled: first.substitutes.length >= MAX_SUBSTITUTES,
            onSelect: () => actions.onAddSubstitute(first.id),
          },
        ]
      : []),
    { label: 'Notes', onSelect: focusNote },
    { label: choice ? 'Delete pick-one group' : 'Delete exercise', danger: true, onSelect: remove },
  ];

  return (
    <section
      aria-labelledby={headingId}
      className={styles.block}
      data-open={unfolded ? '' : undefined}
      data-superset={inSuperset ? '' : undefined}
      data-block-id={block.id}
      data-card-id={inSuperset ? first.id : block.id}
    >
      {/* iPad portrait: one tappable line (name, then "4 × 8 @ 60 kg · rest 1:30") and the ⋯ menu. */}
      <div className={styles.fold}>
        <button
          type="button"
          className={styles.foldButton}
          aria-expanded={unfolded}
          aria-controls={bodyId}
          aria-label={`${summary.title}: ${summary.line}`}
          onClick={onToggle}
          data-ph-capture-attribute-label="workout_block_fold"
        >
          <span className={styles.blockNumber} aria-hidden="true">{badge}</span>
          <span className={styles.foldText}>
            <span className={styles.foldTitle}>{summary.title}</span>
            <span className={styles.foldLine}>{summary.line}</span>
            {!unfolded
              ? summary.parts.map((p) => (
                  <span key={p.key} className={styles.foldLine}>
                    {p.name} · {p.line}
                  </span>
                ))
              : null}
            {hasErrors ? <span className={styles.foldError}>Needs a fix</span> : null}
          </span>
          <span className={styles.foldChevron} aria-hidden="true">
            <Icon name="chevron" size={20} />
          </span>
        </button>
        <BlockMenu name={summary.title} items={menuItems} />
      </div>
      {moving ? (
        <MoveToDialog
          name={inSuperset ? 'the superset' : summary.title}
          places={siblings.map((s) => ({
            key: s.id,
            label: s.title,
            current: s.id === block.id,
            onSelect: () => onMoveTo?.(s.index),
          }))}
          sections={targets.map((t) => ({
            key: t.id,
            label: t.name,
            onSelect: () => actions.onMoveToSection(t.id === 'none' ? null : t.id),
          }))}
          onClose={() => setMoving(false)}
        />
      ) : null}
      <div id={bodyId} className={styles.blockBody}>
      <header className={styles.blockHeader}>
        <span className={styles.blockNumber} aria-hidden="true">{badge}</span>
        {choice ? (
          <TitleTag id={headingId} className={styles.blockTitle}>{`Pick one · ${block.exercises.length} options`}</TitleTag>
        ) : (
          // The section is named by the exercise name alone (headingId sits on the name inside the button).
          <TitleTag className={styles.blockTitle}>
            <SwapName name={first.exerciseName} nameId={headingId} onSwap={() => actions.onSwap(first.id)} />
          </TitleTag>
        )}
        {!choice ? (
          <MeasurementsMenu
            trackingType={first.trackingType}
            exerciseName={first.exerciseName}
            onToggle={(m) => actions.onToggleMeasurement(first.id, m)}
            rest={restState(block, shown[0]!.ei, restOff)}
            onToggleRest={(on) => actions.onToggleRest(first.id, on)}
          />
        ) : null}
        <div className={styles.blockTools}>
          {targets.length > 0 && (!inSuperset || member === 0) ? (
            <select
              className={`${styles.input} ${styles.moveSelect}`}
              aria-label={`Move ${inSuperset ? 'the superset' : shortTitle} to a section`}
              value=""
              onChange={(e) => {
                if (e.target.value) actions.onMoveToSection(e.target.value === 'none' ? null : e.target.value);
              }}
            >
              <option value="">Move to section…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : null}
          {!choice ? <SubstituteButton exercise={first} onAdd={() => actions.onAddSubstitute(first.id)} /> : null}
          <IconButton
            icon="trash"
            label={`Remove ${shortTitle}`}
            title={choice ? 'Remove pick-one group' : 'Remove exercise'}
            onClick={remove}
          />
        </div>
      </header>
      {(!inSuperset || member === 0) && (errors.get(`block:${block.id}`) ?? []).map((m) => (
        <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
      ))}

      {shown.map(({ ex, ei }, k) => (
        <div key={ex.id} className={styles.exercise}>
          {choice ? (
            <div className={styles.exerciseHeader}>
              <ExerciseTag className={styles.exerciseName}>
                <SwapName name={ex.exerciseName} onSwap={() => actions.onSwap(ex.id)} />
              </ExerciseTag>
              <MeasurementsMenu
                trackingType={ex.trackingType}
                exerciseName={ex.exerciseName}
                onToggle={(m) => actions.onToggleMeasurement(ex.id, m)}
                rest={restState(block, ei, restOff)}
                onToggleRest={(on) => actions.onToggleRest(ex.id, on)}
              />
              <div className={styles.blockTools}>
                <IconButton
                  icon="trash"
                  label={`Remove ${ex.exerciseName}`}
                  title="Remove exercise"
                  onClick={() => actions.onRemoveExercise(ex.id)}
                />
              </div>
            </div>
          ) : null}
          <ExerciseSets block={block} ei={ei} units={units} errors={errors} actions={actions} restOff={restOff} />
          <ExerciseOptions
            exercise={ex}
            errors={errors.get(`tempo:${ex.id}`) ?? []}
            onChange={(patch) => actions.onExerciseOptions(ex.id, patch)}
          />
          <div className={styles.exerciseFooter}>
            <AddSetButton label={`Add a set to ${ex.exerciseName}`} onClick={() => actions.onAddSet(ex.id)} />
            <ExerciseNote exercise={ex} id={k === 0 ? noteId : undefined} onChange={(note) => actions.onExerciseNote(ex.id, note)} />
          </div>
          <Substitutes block={block} ei={ei} units={units} errors={errors} actions={actions} restOff={restOff} />
        </div>
      ))}

      {choice ? (
        <div className={styles.blockFooter}>
          <button
            type="button"
            className={styles.smallButton}
            disabled={block.exercises.length >= MAX_CHOICE_OPTIONS}
            onClick={actions.onAddOption}
          >
            + Add option
          </button>
          {block.exercises.length >= MAX_CHOICE_OPTIONS ? (
            <p className={`${styles.caption} ${styles.blockHelp}`}>A pick-one group has at most {MAX_CHOICE_OPTIONS} options.</p>
          ) : null}
        </div>
      ) : null}
      </div>
    </section>
  );
}

type ExerciseProps = {
  block: WorkoutBlockDoc;
  ei: number;
  units: Units;
  errors: ReadonlyMap<string, string[]>;
  actions: BlockActions;
  restOff: ReadonlySet<string>;
  stacked?: boolean;
};

/** One exercise's error messages and set rows (shared with the phone exercise editor). */
export function ExerciseSets({ block, ei, units, errors, actions, restOff, stacked = false }: ExerciseProps) {
  const ex = block.exercises[ei]!;
  return (
    <>
      {(errors.get(`exercise:${ex.id}`) ?? []).map((m) => (
        <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
      ))}
      <SetTable
        sets={ex.sets}
        names={rowNames(ex.sets).map((n) => `${ex.exerciseName} ${n}`)}
        trackingType={ex.trackingType}
        units={units}
        restShown={restShownFor(block, ei, restOff)}
        errors={errors}
        onUpdate={(setId, patch) => actions.onUpdateSet(ex.id, setId, patch)}
        onRemove={(setId) => actions.onRemoveSet(ex.id, setId)}
        stacked={stacked}
      />
    </>
  );
}

/** The exercise's coach-added substitutes, each with its own sets. */
export function Substitutes({ block, ei, units, errors, actions, restOff, stacked = false }: ExerciseProps) {
  const ex = block.exercises[ei]!;
  return ex.substitutes.map((sub) => (
    <SubstituteEditor
      key={sub.id}
      block={block}
      exerciseIndex={ei}
      substitute={sub}
      units={units}
      errors={errors}
      actions={actions.substitute(ex.id, sub.id)}
      restOff={restOff.has(ex.id)}
      stacked={stacked}
    />
  ));
}

export function ExerciseNote({ exercise: ex, id, onChange }: { exercise: WorkoutExerciseDoc; id?: string | undefined; onChange: (note: string | null) => void }) {
  return (
    <label className={styles.exerciseNote}>
      <span className={styles.visuallyHidden}>Note for {ex.exerciseName}</span>
      <input
        id={id}
        type="text"
        placeholder="Exercise note (optional)"
        maxLength={500}
        className={styles.input}
        value={ex.note ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </label>
  );
}

/** "+ Substitute" as an icon: off once the exercise has the most substitutes allowed. */
function SubstituteButton({ exercise, onAdd }: { exercise: WorkoutExerciseDoc; onAdd: () => void }) {
  const full = exercise.substitutes.length >= MAX_SUBSTITUTES;
  return (
    <IconButton
      icon="substitute"
      label={`Add a substitute for ${exercise.exerciseName}`}
      title={full ? `At most ${MAX_SUBSTITUTES} substitutes` : 'Add substitute'}
      disabled={full}
      onClick={onAdd}
    />
  );
}

/** "+ Set (copies last set)", shared with the substitute editor. */
export function AddSetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.addSet} aria-label={label} title="Adds a copy of the last set" onClick={onClick} data-ph-capture-attribute-label="workout_add_set">
      + Set <span className={styles.addSetHint}>(copies last set)</span>
    </button>
  );
}

/**
 * Each side (a checkbox) and Tempo (optional, "0-0-0-0"), above "+ Set". The tempo is kept as typed; a bad one is
 * marked when the box is left (and refused on save), with the rule as the message.
 */
export function ExerciseOptions({
  exercise: ex,
  errors,
  onChange,
}: {
  exercise: WorkoutExerciseDoc;
  errors: readonly string[];
  onChange: (patch: { eachSide?: boolean; tempo?: string | null }) => void;
}) {
  const tempoId = useId();
  const [left, setLeft] = useState(false);
  const parsed = parseTempo(ex.tempo);
  const messages = [...(left && !parsed.ok ? [parsed.message] : []), ...errors];
  const shown = [...new Set(messages)];
  return (
    <div className={styles.exerciseOptions}>
      <label className={styles.eachSide}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={ex.eachSide === true}
          aria-label={`Each side for ${ex.exerciseName}`}
          onChange={(e) => onChange({ eachSide: e.target.checked })}
        />
        <span aria-hidden="true">Each side</span>
      </label>
      <label className={styles.tempo}>
        <span aria-hidden="true">Tempo</span>
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          className={`${styles.input} ${styles.tempoInput}`}
          placeholder={TEMPO_PLACEHOLDER}
          aria-label={`Tempo for ${ex.exerciseName}`}
          aria-invalid={shown.length > 0 || undefined}
          aria-describedby={shown.length > 0 ? tempoId : undefined}
          value={ex.tempo ?? ''}
          onChange={(e) => {
            setLeft(false);
            onChange({ tempo: e.target.value === '' ? null : e.target.value });
          }}
          onBlur={() => setLeft(true)}
        />
      </label>
      {shown.length > 0 ? (
        <div id={tempoId} className={styles.optionsError}>
          {shown.map((m) => (
            <ErrorText key={m} code="workout_fields_invalid" safe={false}>
              {m}
            </ErrorText>
          ))}
        </div>
      ) : null}
    </div>
  );
}
