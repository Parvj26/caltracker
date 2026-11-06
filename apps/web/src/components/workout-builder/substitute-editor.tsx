'use client';

import { useId, useState } from 'react';
import { TRACKING_TYPE_LABELS, formatSetsSummary, setLabels, substituteSetShowsRest } from '@caltracker/shared';
import type { Units, WorkoutBlockDoc, WorkoutSubstituteDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { rowNames } from './block-editor';
import { gridTemplate, setColumns } from './set-columns';
import { SetRow, type SetPatch } from './set-row';
import styles from './builder.module.css';

export type SubstituteActions = {
  onRemove: () => void;
  onNote: (note: string | null) => void;
  onAddSet: () => void;
  onAddDrop: (setId: string) => void;
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
  const labels = setLabels(sub.sets);
  const names = rowNames(sub.sets);
  const nonDrop = sub.sets.filter((s) => s.setType !== 'drop').length;
  const restShown = sub.sets.map((_, si) => substituteSetShowsRest(block, exerciseIndex, sub, si));
  const columns = setColumns(sub.trackingType, restShown.some(Boolean));

  return (
    <div className={styles.substitute} aria-label={`Substitute: ${sub.exerciseName}`} role="group">
      <div className={styles.exerciseHeader}>
        <span className={styles.substituteName}>
          <span aria-hidden="true">⇄ </span>or: {sub.exerciseName}
        </span>
        <span className={styles.caption}>
          {TRACKING_TYPE_LABELS[sub.trackingType]} · {formatSetsSummary(sub.sets, sub.trackingType, units).text}
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
        <ErrorText key={m}>{m}</ErrorText>
      ))}
      <div id={setsId} hidden={!expanded} className={styles.substituteBody}>
        <div className={styles.sets}>
          <div className={styles.columnCaptions} style={{ gridTemplateColumns: gridTemplate(columns) }} aria-hidden="true">
            {columns.map((c) => (
              <span key={c.key}>{c.caption}</span>
            ))}
          </div>
          {sub.sets.map((s, si) => (
            <SetRow
              key={s.id}
              set={s}
              label={labels[si]!}
              name={`${sub.exerciseName} (substitute) ${names[si]}`}
              trackingType={sub.trackingType}
              units={units}
              showRest={restShown[si]!}
              canRemove={s.setType === 'drop' || nonDrop > 1}
              errors={errors.get(`set:${s.id}`) ?? []}
              onChange={(patch) => actions.onUpdateSet(s.id, patch)}
              onAddDrop={s.setType === 'drop' ? null : () => actions.onAddDrop(s.id)}
              onRemove={() => actions.onRemoveSet(s.id)}
            />
          ))}
        </div>
        <div className={styles.exerciseFooter}>
          <button
            type="button"
            className={styles.smallButton}
            aria-label={`Add a set to substitute ${sub.exerciseName}`}
            onClick={actions.onAddSet}
          >
            + Set
          </button>
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
