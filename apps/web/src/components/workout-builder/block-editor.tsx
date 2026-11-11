'use client';

import { useId, useState } from 'react';
import { MAX_CHOICE_OPTIONS, MAX_SUBSTITUTES, TEMPO_PLACEHOLDER, parseTempo, setShowsRest } from '@caltracker/shared';
import type { Measurement, Units, WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
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
function IconButton({
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
function SwapName({ name, nameId, onSwap }: { name: string; nameId?: string; onSwap: () => void }) {
  return (
    <button type="button" className={styles.swapName} aria-label={`Swap exercise: ${name}`} title="Tap to swap exercise" onClick={onSwap}>
      <span id={nameId}>{name}</span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

export type BlockActions = {
  onMove: (delta: -1 | 1) => void;
  onRemoveBlock: () => void;
  onAddRound: () => void;
  onRemoveRound: () => void;
  onAddExercise: () => void;
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
  /** Each side and Tempo, above "+ Set". */
  onExerciseOptions: (exId: string, patch: { eachSide?: boolean; tempo?: string | null }) => void;
  onAddSubstitute: (exId: string) => void;
  substitute: (exId: string, substituteId: string) => SubstituteActions;
};

type Props = {
  block: WorkoutBlockDoc;
  /** 0-based position among all blocks (the number shown), and whether it can move up / down inside its section. */
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** The workout's sections, to offer "Move to section…" (omitted or empty: no menu). */
  sections: ReadonlyArray<{ id: string; name: string }>;
  units: Units;
  /** Inline errors keyed by `block:<id>`, `exercise:<id>`, `tempo:<exercise id>` and `set:<id>`. */
  errors: ReadonlyMap<string, string[]>;
  actions: BlockActions;
};

const rounds = (e: WorkoutExerciseDoc) => e.sets.filter((s) => s.setType !== 'drop').length;

/** "3 rounds" when every exercise has the same number of sets, otherwise "3 + 2 sets" (supersets may be uneven). */
export function supersetTitle(block: WorkoutBlockDoc): string {
  const counts = block.exercises.map(rounds);
  const even = counts.every((c) => c === counts[0]);
  return `Superset / circuit · ${even ? `${counts[0]} rounds` : `${counts.join(' + ')} sets`}`;
}

export function BlockEditor({ block, index, canMoveUp, canMoveDown, sections, units, errors, actions }: Props) {
  const headingId = useId();
  const superset = block.kind === 'superset';
  const first = block.exercises[0]!;
  const choice = block.kind === 'choice';
  const multi = superset || choice;
  const title = superset
    ? supersetTitle(block)
    : choice
      ? `Pick one · ${block.exercises.length} options`
      : first.exerciseName;
  const shortTitle = superset ? `superset ${index + 1}` : choice ? `pick-one group ${index + 1}` : first.exerciseName;
  const minRounds = Math.min(...block.exercises.map(rounds));
  // Under a section's (hidden) <h2>, a block's title is an <h3> and its exercises <h4>, so heading navigation shows
  // which blocks belong to which section. Blocks outside any section keep <h2> / <h3>.
  const inSection = block.sectionId !== null && sections.some((sec) => sec.id === block.sectionId);
  const TitleTag = inSection ? 'h3' : 'h2';
  const ExerciseTag = inSection ? 'h4' : 'h3';
  const targets = [
    ...(block.sectionId !== null ? [{ id: 'none', name: 'No section' }] : []),
    ...sections.filter((sec) => sec.id !== block.sectionId),
  ];

  return (
    <section aria-labelledby={headingId} className={styles.block}>
      <header className={styles.blockHeader}>
        <span className={styles.blockNumber} aria-hidden="true">{index + 1}</span>
        {multi ? (
          <TitleTag id={headingId} className={styles.blockTitle}>{title}</TitleTag>
        ) : (
          // The section is named by the exercise name alone (headingId sits on the name inside the button).
          <TitleTag className={styles.blockTitle}>
            <SwapName name={first.exerciseName} nameId={headingId} onSwap={() => actions.onSwap(first.id)} />
          </TitleTag>
        )}
        {!multi ? (
          <MeasurementsMenu
            trackingType={first.trackingType}
            exerciseName={first.exerciseName}
            onToggle={(m) => actions.onToggleMeasurement(first.id, m)}
          />
        ) : null}
        <div className={styles.blockTools}>
          {targets.length > 0 ? (
            <select
              className={`${styles.input} ${styles.moveSelect}`}
              aria-label={`Move ${shortTitle} to a section`}
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
          {!multi ? <SubstituteButton exercise={first} onAdd={() => actions.onAddSubstitute(first.id)} /> : null}
          <IconButton icon="up" label={`Move ${shortTitle} up`} title="Move up" disabled={!canMoveUp} onClick={() => actions.onMove(-1)} />
          <IconButton icon="down" label={`Move ${shortTitle} down`} title="Move down" disabled={!canMoveDown} onClick={() => actions.onMove(1)} />
          <IconButton
            icon="trash"
            label={`Remove ${shortTitle}`}
            title={multi ? (superset ? 'Remove superset' : 'Remove pick-one group') : 'Remove exercise'}
            onClick={actions.onRemoveBlock}
          />
        </div>
      </header>
      {(errors.get(`block:${block.id}`) ?? []).map((m) => (
        <ErrorText key={m}>{m}</ErrorText>
      ))}

      {block.exercises.map((ex, ei) => {
        const names = rowNames(ex.sets);
        // In a superset the rest after a round sits on the round's last exercise; the others go straight on.
        const restShown = ex.sets.map((_, si) => setShowsRest(block, ei, si));
        return (
          <div key={ex.id} className={styles.exercise}>
            {multi ? (
              <div className={styles.exerciseHeader}>
                <ExerciseTag className={styles.exerciseName}>
                  <SwapName name={ex.exerciseName} onSwap={() => actions.onSwap(ex.id)} />
                </ExerciseTag>
                <MeasurementsMenu
                  trackingType={ex.trackingType}
                  exerciseName={ex.exerciseName}
                  onToggle={(m) => actions.onToggleMeasurement(ex.id, m)}
                />
                <div className={styles.blockTools}>
                  {/* Pick-one options are already alternatives to each other, so they get no substitutes. */}
                  {!choice ? <SubstituteButton exercise={ex} onAdd={() => actions.onAddSubstitute(ex.id)} /> : null}
                  <IconButton
                    icon="trash"
                    label={`Remove ${ex.exerciseName}`}
                    title="Remove exercise"
                    onClick={() => actions.onRemoveExercise(ex.id)}
                  />
                </div>
              </div>
            ) : null}
            {(errors.get(`exercise:${ex.id}`) ?? []).map((m) => (
              <ErrorText key={m}>{m}</ErrorText>
            ))}
            <SetTable
              sets={ex.sets}
              names={names.map((n) => `${ex.exerciseName} ${n}`)}
              trackingType={ex.trackingType}
              units={units}
              restShown={restShown}
              errors={errors}
              onUpdate={(setId, patch) => actions.onUpdateSet(ex.id, setId, patch)}
              onRemove={(setId) => actions.onRemoveSet(ex.id, setId)}
            />
            <ExerciseOptions
              exercise={ex}
              errors={errors.get(`tempo:${ex.id}`) ?? []}
              onChange={(patch) => actions.onExerciseOptions(ex.id, patch)}
            />
            <div className={styles.exerciseFooter}>
              <AddSetButton label={`Add a set to ${ex.exerciseName}`} onClick={() => actions.onAddSet(ex.id)} />
              <label className={styles.exerciseNote}>
                <span className={styles.visuallyHidden}>Note for {ex.exerciseName}</span>
                <input
                  type="text"
                  placeholder="Exercise note (optional)"
                  maxLength={500}
                  className={styles.input}
                  value={ex.note ?? ''}
                  onChange={(e) => actions.onExerciseNote(ex.id, e.target.value === '' ? null : e.target.value)}
                />
              </label>
            </div>
            {ex.substitutes.map((sub) => (
              <SubstituteEditor
                key={sub.id}
                block={block}
                exerciseIndex={ei}
                substitute={sub}
                units={units}
                errors={errors}
                actions={actions.substitute(ex.id, sub.id)}
              />
            ))}
          </div>
        );
      })}

      {superset ? (
        <div className={styles.blockFooter}>
          <button type="button" className={styles.smallButton} onClick={actions.onAddRound}>
            + Round
          </button>
          <button
            type="button"
            className={styles.smallButton}
            aria-label="Remove the last round"
            disabled={minRounds <= 1}
            aria-describedby={minRounds <= 1 ? `${headingId}-round-help` : undefined}
            onClick={actions.onRemoveRound}
          >
            − Round
          </button>
          <button type="button" className={styles.smallButton} onClick={actions.onAddExercise}>
            + Exercise to superset
          </button>
          {minRounds <= 1 ? (
            <p id={`${headingId}-round-help`} className={`${styles.caption} ${styles.blockHelp}`}>
              Can&apos;t remove a round: an exercise here has only one set.
            </p>
          ) : null}
        </div>
      ) : null}

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
    </section>
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
    <button type="button" className={styles.addSet} aria-label={label} title="Adds a copy of the last set" onClick={onClick}>
      + Set <span className={styles.addSetHint}>(copies last set)</span>
    </button>
  );
}

/**
 * Each side (a checkbox) and Tempo (optional, "0-0-0-0"), above "+ Set". The tempo is kept as typed; a bad one is
 * marked when the box is left (and refused on save), with the rule as the message.
 */
function ExerciseOptions({
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
            <ErrorText key={m}>{m}</ErrorText>
          ))}
        </div>
      ) : null}
    </div>
  );
}
