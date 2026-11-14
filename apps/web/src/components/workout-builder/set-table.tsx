'use client';

import { useState } from 'react';
import { SET_KIND_NAMES, setKindOf, setLineParts } from '@caltracker/shared';
import type { SetKind, TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { SetRow, type SetPatch } from './set-row';
import { SetSheet } from './set-sheet';
import styles from './builder.module.css';

const CHIP_CLASS: Record<SetKind, string | undefined> = {
  W: styles.kindW,
  N: styles.kindN,
  F: styles.kindF,
  D: styles.kindD,
};

type Props = {
  sets: readonly WorkoutSetDoc[];
  /** "Barbell Squat", or "Barbell Deadlift (substitute)": the set editor's subtitle. */
  exerciseName: string;
  /** Accessible row names, e.g. "Barbell Squat set 2". */
  names: readonly string[];
  trackingType: TrackingType;
  units: Units;
  /** Per set: false for a superset exercise that runs straight into the next one (no rest box). */
  restShown: readonly boolean[];
  errors: ReadonlyMap<string, string[]>;
  onUpdate: (setId: string, patch: SetPatch) => void;
  onRemove: (setId: string) => void;
};

/**
 * An exercise's sets. From 600 px (iPad, desktop) each set is a small card with a caption above each box. Below
 * 600 px (iPhone) each set is one tappable line instead, and a tap opens the bottom-sheet editor (SetSheet), which
 * edits the same doc through the same onUpdate / onRemove. builder.module.css shows one or the other.
 */
export function SetTable({ sets, exerciseName, names, trackingType, units, restShown, errors, onUpdate, onRemove }: Props) {
  // iPhone width: the set being edited in the bottom sheet, by id (so removing another set doesn't move it).
  const [editing, setEditing] = useState<string | null>(null);
  const editingIndex = editing === null ? -1 : sets.findIndex((s) => s.id === editing);
  return (
    <>
    {/* iPhone width (below 600 px): one line per set ("12 × 10 kg · rest 1:30"); a tap opens the set editor sheet.
        builder.module.css shows these lines or the rows below, never both. */}
    <ol className={styles.setLines}>
      {sets.map((s, si) => {
        const { values, rest } = setLineParts(s, trackingType, units, { showsRest: restShown[si]! });
        const kind = setKindOf(s);
        const setErrors = errors.get(`set:${s.id}`) ?? [];
        return (
          <li key={s.id} className={cx(styles.setLineItem, s.setType === 'drop' && styles.setLineDrop)}>
            <button
              type="button"
              className={styles.setLine}
              aria-haspopup="dialog"
              aria-label={`Edit ${names[si]}: ${kind === 'N' ? '' : `${SET_KIND_NAMES[kind]}, `}${values ?? 'Not filled yet'}, ${rest}`}
              onClick={() => setEditing(s.id)}
              data-ph-capture-attribute-label="workout_set_line"
            >
              <span className={styles.setLineNumber} aria-hidden="true">{si + 1}</span>
              {kind !== 'N' ? (
                <span className={cx(styles.setLineChip, CHIP_CLASS[kind])} aria-hidden="true">
                  {kind}
                </span>
              ) : null}
              <span className={values ? styles.setLineValues : styles.setLineBlank} aria-hidden="true">
                {values ?? 'Not filled yet'}
              </span>
              <span className={styles.setLineRest} aria-hidden="true">{rest}</span>
              <span className={styles.setLineChevron} aria-hidden="true">›</span>
            </button>
            {setErrors.map((message) => (
              <ErrorText key={message} code="workout_fields_invalid" safe={false}>
                {message}
              </ErrorText>
            ))}
          </li>
        );
      })}
    </ol>
    {editingIndex >= 0 ? (
      <SetSheet
        sets={sets}
        index={editingIndex}
        exerciseName={exerciseName}
        trackingType={trackingType}
        units={units}
        restShown={restShown}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onGoTo={(i) => setEditing(sets[i]?.id ?? null)}
        onClose={() => setEditing(null)}
      />
    ) : null}
    <div className={styles.sets}>
      {sets.map((s, si) => (
        <SetRow
          key={s.id}
          set={s}
          number={si + 1}
          name={names[si]!}
          trackingType={trackingType}
          units={units}
          showRest={restShown[si]!}
          canRemove={sets.length > 1}
          canDrop={si > 0}
          errors={errors.get(`set:${s.id}`) ?? []}
          onChange={(patch) => onUpdate(s.id, patch)}
          onRemove={() => onRemove(s.id)}
        />
      ))}
    </div>
    </>
  );
}
