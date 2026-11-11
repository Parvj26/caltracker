'use client';

import { useId, useState } from 'react';
import { trackingTypeLabel, formatSetsSummary, substituteSetShowsRest } from '@caltracker/shared';
import type { Units, WorkoutBlockDoc, WorkoutSubstituteDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { AddSetButton, rowNames } from './block-editor';
import { type SetPatch } from './set-row';
import { SetTable } from './set-table';
import styles from './builder.module.css';

export type SubstituteActions = {
  onRemove: () => void;
  onNote: (note: string | null) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, patch: SetPatch) => void;
};

type Props = {
  block: WorkoutBlockDoc;
  exerciseIndex: number;
  substitute: WorkoutSubstituteDoc;
  units: Units;
  errors: ReadonlyMap<string, string[]>;
  actions: SubstituteActions;
};

/**
 * One coach-added substitute under its exercise: "or: Machine Assisted Pull Up" with its own sets. The sets start
 * collapsed (a copy of the exercise's sets is usually right) and open by themselves when one has an error.
 */
export function SubstituteEditor({ block, exerciseIndex, substitute: sub, units, errors, actions }: Props) {
  const setsId = useId();
  const [open, setOpen] = useState(false);
  const hasErrors =
    errors.has(`substitute:${sub.id}`) || sub.sets.some((s) => errors.has(`set:${s.id}`));
  const expanded = open || hasErrors;
  const names = rowNames(sub.sets);
  const restShown = sub.sets.map((_, si) => substituteSetShowsRest(block, exerciseIndex, sub, si));

  return (
    <div className={styles.substitute} aria-label={`Substitute: ${sub.exerciseName}`} role="group">
      <div className={styles.exerciseHeader}>
        <span className={styles.substituteName}>
          <span aria-hidden="true">⇄ </span>or: {sub.exerciseName}
        </span>
        <span className={styles.caption}>
          {trackingTypeLabel(sub.trackingType)} · {formatSetsSummary(sub.sets, sub.trackingType, units).text}
        </span>
        <div className={styles.blockTools}>
          <button
            type="button"
            className={styles.smallButton}
            aria-expanded={expanded}
            aria-controls={setsId}
            disabled={hasErrors}
            onClick={() => setOpen((o) => !o)}
          >
            {expanded ? 'Hide sets' : 'Edit sets'}
          </button>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Remove substitute ${sub.exerciseName}`}
            onClick={actions.onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      {(errors.get(`substitute:${sub.id}`) ?? []).map((m) => (
        <ErrorText key={m} code="workout_fields_invalid" safe={false}>
          {m}
        </ErrorText>
      ))}
      <div id={setsId} hidden={!expanded} className={styles.substituteBody}>
        <SetTable
          sets={sub.sets}
          names={names.map((n) => `${sub.exerciseName} (substitute) ${n}`)}
          trackingType={sub.trackingType}
          units={units}
          restShown={restShown}
          errors={errors}
          onUpdate={actions.onUpdateSet}
          onRemove={actions.onRemoveSet}
        />
        <div className={styles.exerciseFooter}>
          <AddSetButton label={`Add a set to substitute ${sub.exerciseName}`} onClick={actions.onAddSet} />
          <label className={styles.exerciseNote}>
            <span className={styles.visuallyHidden}>Note for substitute {sub.exerciseName}</span>
            <input
              type="text"
              placeholder="Substitute note (optional)"
              maxLength={500}
              className={styles.input}
              value={sub.note ?? ''}
              onChange={(e) => actions.onNote(e.target.value === '' ? null : e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
