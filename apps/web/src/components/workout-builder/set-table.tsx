'use client';

import type { CSSProperties } from 'react';
import { distanceUnitFor, targetFieldsFor } from '@caltracker/shared';
import type { TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { SetRow, type SetPatch } from './set-row';
import styles from './builder.module.css';

type Props = {
  sets: readonly WorkoutSetDoc[];
  /** Accessible row names, e.g. "Barbell Squat set 2". */
  names: readonly string[];
  trackingType: TrackingType;
  units: Units;
  /** Per set: false when it has no rest box (Rest is off, or a superset exercise that runs straight into the next). */
  restShown: readonly boolean[];
  errors: ReadonlyMap<string, string[]>;
  onUpdate: (setId: string, patch: SetPatch) => void;
  onRemove: (setId: string) => void;
  /** The phone exercise editor: smaller boxes, "Wt" at three or more boxes. */
  compact?: boolean;
};

/**
 * An exercise's sets as one slim table (approved mockups CW7), the same on every size: the column names once on top
 * (Set · Type · the boxes the exercise tracks · Rest), then one row per set on the same columns, ending in a fixed
 * slot for × (or, on touch screens, the focused box's − / +). `--set-cols` sizes the columns to this exercise's boxes.
 * `compact` (a phone): at three or more boxes the weight column is called "Wt".
 */
export function SetTable({ sets, names, trackingType, units, restShown, errors, onUpdate, onRemove, compact = false }: Props) {
  const fields = targetFieldsFor(trackingType);
  const hasRest = sets.some((s, i) => restShown[i] && s.setType !== 'drop');
  const boxes = fields.length + (hasRest ? 1 : 0);
  const weightName = compact && boxes >= 3 ? `Wt (${units})` : `Weight (${units})`;
  const columns: string[] = [
    ...(fields.includes('reps') ? ['Reps'] : []),
    ...(fields.includes('weight') ? [weightName] : []),
    ...(fields.includes('duration') ? ['Time'] : []),
    ...(fields.includes('distance') ? [`Distance (${distanceUnitFor(units)})`] : []),
    // Same rule as SetRow: a drop never has a rest box.
    ...(hasRest ? ['Rest'] : []),
  ];
  // Number, type letter, one share of the width per box (at most 8rem each, so short rows don't stretch), the tray.
  const style = { '--set-cols': `var(--set-num) var(--set-type) repeat(${columns.length}, minmax(0, 8rem)) 1fr var(--set-tray)` } as CSSProperties;
  return (
    <div className={styles.sets} style={style} data-compact={compact || undefined} data-many={boxes >= 3 || undefined}>
      <div className={styles.setColumns} aria-hidden="true">
        <span>Set</span>
        <span>Type</span>
        {columns.map((caption) => (
          <span key={caption}>{caption}</span>
        ))}
      </div>
      {sets.map((s, si) => (
        <SetRow
          key={s.id}
          set={s}
          number={si + 1}
          name={names[si]!}
          trackingType={trackingType}
          units={units}
          showRest={restShown[si]!}
          restColumn={hasRest}
          canRemove={sets.length > 1}
          canDrop={si > 0}
          errors={errors.get(`set:${s.id}`) ?? []}
          onChange={(patch) => onUpdate(s.id, patch)}
          onRemove={() => onRemove(s.id)}
          compact={compact}
        />
      ))}
    </div>
  );
}
