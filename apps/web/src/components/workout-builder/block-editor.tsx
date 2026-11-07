'use client';

import { useId, useState } from 'react';
import { MAX_CHOICE_OPTIONS, MAX_SUBSTITUTES, trackingTypeLabel, hasTargets, setLabels, setShowsRest } from '@caltracker/shared';
import type { Units, WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { gridTemplate, setColumns } from './set-columns';
import { SetRow, type SetPatch } from './set-row';
import { SubstituteEditor, type SubstituteActions } from './substitute-editor';
import styles from './builder.module.css';

/** Row names for screen readers and tests: "set 1", "warm-up set", "drop after set 3", "drop 2 after set 3". */
export function rowNames(sets: readonly WorkoutSetDoc[]): string[] {
  const labels = setLabels(sets);
  const warmups = sets.filter((s) => s.setType === 'warmup').length;
  let warmupSeen = 0;
  let parent = '';
  let dropsOfParent = 0;
  return sets.map((s, i) => {
    if (s.setType === 'drop') {
      dropsOfParent += 1;
      return dropsOfParent === 1 ? `drop after ${parent}` : `drop ${dropsOfParent} after ${parent}`;
    }
    dropsOfParent = 0;
    if (s.setType === 'warmup') {
      warmupSeen += 1;
      parent = warmups > 1 ? `warm-up set ${warmupSeen}` : 'warm-up set';
    } else {
      parent = `set ${labels[i]}`;
    }
    return parent;
  });
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
  onAddSet: (exId: string) => void;
  onAddDrop: (exId: string, setId: string) => void;
  onRemoveSet: (exId: string, setId: string) => void;
  onUpdateSet: (exId: string, setId: string, patch: SetPatch) => void;
  onAddSubstitute: (exId: string) => void;
  substitute: (exId: string, substituteId: string) => SubstituteActions;
  /** "Copy set 1 to all sets" and "Fill down from set N": see fillDown in packages/shared. */
  onCopyToAll: (exId: string) => void;
  onFillDown: (exId: string, setId: string) => void;
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
  /** Inline errors keyed by `block:<id>`, `exercise:<id>` and `set:<id>`. */
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
  // Per exercise, bumped after a copy, so that exercise's set rows remount and show copied rep ranges as ranges (a
  // row picks single or range when it mounts).
  const [copies, setCopies] = useState<Readonly<Record<string, number>>>({});
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
        <TitleTag id={headingId} className={styles.blockTitle}>{title}</TitleTag>
        {!multi ? <span className={styles.caption}>{trackingTypeLabel(first.trackingType)}</span> : null}
        <div className={styles.blockTools}>
          {!multi ? (
            <button type="button" className={styles.smallButton} onClick={() => actions.onSwap(first.id)}>
              Swap exercise
            </button>
          ) : null}
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${shortTitle} up`}
            disabled={!canMoveUp}
            onClick={() => actions.onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${shortTitle} down`}
            disabled={!canMoveDown}
            onClick={() => actions.onMove(1)}
          >
            ↓
          </button>
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
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Remove ${shortTitle}`}
            onClick={actions.onRemoveBlock}
          >
            Remove
          </button>
        </div>
      </header>
      {(errors.get(`block:${block.id}`) ?? []).map((m) => (
        <ErrorText key={m}>{m}</ErrorText>
      ))}

      {block.exercises.map((ex, ei) => {
        const labels = setLabels(ex.sets);
        const names = rowNames(ex.sets);
        const nonDrop = rounds(ex);
        // In a superset the rest after a round sits on the round's last exercise; the others go straight on.
        const restShown = ex.sets.map((_, si) => setShowsRest(block, ei, si));
        const columns = setColumns(ex.trackingType, restShown.some(Boolean));
        // Main sets with another main set below them: where "Fill down" can start. The first is "Copy set 1 to all".
        const fillFrom = ex.sets.flatMap((s, si) =>
          s.setType === 'normal' && ex.sets.slice(si + 1).some((t) => t.setType === 'normal')
            ? [{ id: s.id, label: labels[si]!, ready: hasTargets(s) }]
            : [],
        );
        const copied = (run: () => void) => {
          run();
          setCopies((c) => ({ ...c, [ex.id]: (c[ex.id] ?? 0) + 1 }));
        };
        const copyHintId = `${headingId}-${ex.id}-copy-hint`;
        return (
          <div key={ex.id} className={styles.exercise}>
            {multi ? (
              <div className={styles.exerciseHeader}>
                <ExerciseTag className={styles.exerciseName}>{ex.exerciseName}</ExerciseTag>
                <span className={styles.caption}>{trackingTypeLabel(ex.trackingType)}</span>
                <div className={styles.blockTools}>
                  <button type="button" className={styles.smallButton} onClick={() => actions.onSwap(ex.id)}>
                    Swap exercise
                  </button>
                  <button
                    type="button"
                    className={styles.smallButton}
                    aria-label={`Remove ${ex.exerciseName}`}
                    onClick={() => actions.onRemoveExercise(ex.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
            {(errors.get(`exercise:${ex.id}`) ?? []).map((m) => (
              <ErrorText key={m}>{m}</ErrorText>
            ))}
            <div className={styles.sets}>
              {/* Sighted coaches' column labels; each input already carries its own name for screen readers. */}
              <div className={styles.columnCaptions} style={{ gridTemplateColumns: gridTemplate(columns) }} aria-hidden="true">
                {columns.map((c) => (
                  <span key={c.key}>{c.caption}</span>
                ))}
              </div>
              {ex.sets.map((s, si) => (
                <SetRow
                  key={`${s.id}:${copies[ex.id] ?? 0}`}
                  set={s}
                  label={labels[si]!}
                  name={`${ex.exerciseName} ${names[si]}`}
                  trackingType={ex.trackingType}
                  units={units}
                  showRest={restShown[si]!}
                  canRemove={s.setType === 'drop' || nonDrop > 1}
                  errors={errors.get(`set:${s.id}`) ?? []}
                  onChange={(patch) => actions.onUpdateSet(ex.id, s.id, patch)}
                  onAddDrop={s.setType === 'drop' ? null : () => actions.onAddDrop(ex.id, s.id)}
                  onRemove={() => actions.onRemoveSet(ex.id, s.id)}
                />
              ))}
            </div>
            <div className={styles.exerciseFooter}>
              <button
                type="button"
                className={styles.smallButton}
                {...(multi ? { 'aria-label': `Add a set to ${ex.exerciseName}` } : {})}
                onClick={() => actions.onAddSet(ex.id)}
              >
                + Set
              </button>
              {/* Pick-one options are already alternatives to each other, so they get no substitutes. */}
              {!choice ? (
                <button
                  type="button"
                  className={styles.smallButton}
                  aria-label={`Add a substitute for ${ex.exerciseName}`}
                  disabled={ex.substitutes.length >= MAX_SUBSTITUTES}
                  title={ex.substitutes.length >= MAX_SUBSTITUTES ? `At most ${MAX_SUBSTITUTES} substitutes` : undefined}
                  onClick={() => actions.onAddSubstitute(ex.id)}
                >
                  + Substitute
                </button>
              ) : null}
              {fillFrom.length > 0 ? (
                <>
                  <button
                    type="button"
                    className={styles.smallButton}
                    aria-label={`Copy set ${fillFrom[0]!.label} of ${ex.exerciseName} to all sets`}
                    aria-describedby={copyHintId}
                    disabled={!fillFrom[0]!.ready}
                    onClick={() => copied(() => actions.onCopyToAll(ex.id))}
                  >
                    Copy set {fillFrom[0]!.label} to all sets
                  </button>
                  <span id={copyHintId} className={fillFrom[0]!.ready ? styles.visuallyHidden : styles.caption}>
                    {fillFrom[0]!.ready
                      ? 'Copies reps, weight and rest to the other main sets. Warm-ups and drop sets stay as they are.'
                      : `Type set ${fillFrom[0]!.label} first, then copy it.`}
                  </span>
                </>
              ) : null}
              {fillFrom.length > 1 ? (
                <FillDown
                  exerciseName={ex.exerciseName}
                  options={fillFrom.slice(1)}
                  onFill={(setId) => copied(() => actions.onFillDown(ex.id, setId))}
                />
              ) : null}
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

/** "Fill down from [set 2] [Fill]": choosing a set only picks it (arrow keys never fill); the button fills. */
function FillDown({
  exerciseName,
  options,
  onFill,
}: {
  exerciseName: string;
  options: ReadonlyArray<{ id: string; label: string; ready: boolean }>;
  onFill: (setId: string) => void;
}) {
  const [choice, setChoice] = useState('');
  const picked = options.find((o) => o.id === choice);
  return (
    <>
      <select
        className={`${styles.input} ${styles.moveSelect}`}
        aria-label={`Fill down ${exerciseName} from a set`}
        value={picked ? picked.id : ''}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="">Fill down from…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            Set {o.label} to the sets below
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.smallButton}
        aria-label={`Fill down ${exerciseName}`}
        disabled={!picked || !picked.ready}
        title={picked && !picked.ready ? `Type set ${picked.label} first.` : undefined}
        onClick={() => {
          if (!picked) return;
          onFill(picked.id);
          setChoice('');
        }}
      >
        Fill
      </button>
    </>
  );
}
