'use client';

import { useId } from 'react';
import { TRACKING_TYPE_LABELS, setLabels } from '@caltracker/shared';
import type { Units, WorkoutBlockDoc, WorkoutExerciseDoc, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { gridTemplate, setColumns } from './set-columns';
import { SetRow, type SetPatch } from './set-row';
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
  onSwap: (exId: string) => void;
  onRemoveExercise: (exId: string) => void;
  onExerciseNote: (exId: string, note: string | null) => void;
  onAddSet: (exId: string) => void;
  onAddDrop: (exId: string, setId: string) => void;
  onRemoveSet: (exId: string, setId: string) => void;
  onUpdateSet: (exId: string, setId: string, patch: SetPatch) => void;
};

type Props = {
  block: WorkoutBlockDoc;
  index: number;
  count: number;
  units: Units;
  /** Inline errors keyed by `block:<id>`, `exercise:<id>` and `set:<id>`. */
  errors: ReadonlyMap<string, string[]>;
  actions: BlockActions;
};

const rounds = (e: WorkoutExerciseDoc) => e.sets.filter((s) => s.setType !== 'drop').length;

export function BlockEditor({ block, index, count, units, errors, actions }: Props) {
  const headingId = useId();
  const superset = block.kind === 'superset';
  const first = block.exercises[0]!;
  const title = superset ? `Superset / circuit · ${rounds(first)} rounds` : first.exerciseName;
  const shortTitle = superset ? `superset ${index + 1}` : first.exerciseName;

  return (
    <section aria-labelledby={headingId} className={styles.block}>
      <header className={styles.blockHeader}>
        <span className={styles.blockNumber} aria-hidden="true">{index + 1}</span>
        <h2 id={headingId} className={styles.blockTitle}>{title}</h2>
        {!superset ? <span className={styles.caption}>{TRACKING_TYPE_LABELS[first.trackingType]}</span> : null}
        <div className={styles.blockTools}>
          {!superset ? (
            <button type="button" className={styles.smallButton} onClick={() => actions.onSwap(first.id)}>
              Swap exercise
            </button>
          ) : null}
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${shortTitle} up`}
            disabled={index === 0}
            onClick={() => actions.onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Move ${shortTitle} down`}
            disabled={index === count - 1}
            onClick={() => actions.onMove(1)}
          >
            ↓
          </button>
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
        // In a superset the rest after a round sits on its last exercise; the others go straight on.
        const showRest = !superset || ei === block.exercises.length - 1;
        const columns = setColumns(ex.trackingType, showRest);
        return (
          <div key={ex.id} className={styles.exercise}>
            {superset ? (
              <div className={styles.exerciseHeader}>
                <h3 className={styles.exerciseName}>{ex.exerciseName}</h3>
                <span className={styles.caption}>{TRACKING_TYPE_LABELS[ex.trackingType]}</span>
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
                  key={s.id}
                  set={s}
                  label={labels[si]!}
                  name={`${ex.exerciseName} ${names[si]}`}
                  trackingType={ex.trackingType}
                  units={units}
                  showRest={showRest}
                  canRemove={s.setType === 'drop' || nonDrop > 1}
                  errors={errors.get(`set:${s.id}`) ?? []}
                  onChange={(patch) => actions.onUpdateSet(ex.id, s.id, patch)}
                  onAddDrop={s.setType === 'drop' ? null : () => actions.onAddDrop(ex.id, s.id)}
                  onRemove={() => actions.onRemoveSet(ex.id, s.id)}
                />
              ))}
            </div>
            <div className={styles.exerciseFooter}>
              {!superset ? (
                <button type="button" className={styles.smallButton} onClick={() => actions.onAddSet(ex.id)}>
                  + Set
                </button>
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
            disabled={rounds(first) <= 1}
            onClick={actions.onRemoveRound}
          >
            − Round
          </button>
          <button type="button" className={styles.smallButton} onClick={actions.onAddExercise}>
            + Exercise to superset
          </button>
        </div>
      ) : null}
    </section>
  );
}
