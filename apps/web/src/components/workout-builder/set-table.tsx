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
  /** The phone exercise editor: each set as a card with one labelled line per box (see SetRow). */
  stacked?: boolean;
};

/**
 * An exercise's sets: each a small card with a caption above each box (iPad, desktop), or stacked on a phone. The wide
 * builder's right pane lays the rows out as a table instead: one caption row on top (rendered here, shown only there)
 * and every row on the same columns, which `--set-cols` sizes to this exercise's boxes.
 */
export function SetTable({ sets, names, trackingType, units, restShown, errors, onUpdate, onRemove, stacked = false }: Props) {
  const fields = targetFieldsFor(trackingType);
  // Reps and weight have − / + buttons on touch screens, so their columns never get narrower than 9.5rem (two 44 px buttons and a box that fits "102.5").
  const STEPPED = 'minmax(9.5rem, 1.5fr)';
  const PLAIN = 'minmax(5rem, 1fr)';
  const columns: [caption: string, size: string][] = [
    ...(fields.includes('reps') ? [['Reps', STEPPED] as [string, string]] : []),
    ...(fields.includes('weight') ? [[`Weight (${units})`, STEPPED] as [string, string]] : []),
    ...(fields.includes('duration') ? [['Time', PLAIN] as [string, string]] : []),
    ...(fields.includes('distance') ? [[`Distance (${distanceUnitFor(units)})`, PLAIN] as [string, string]] : []),
    // Same rule as SetRow: a drop never has a rest box.
    ...(sets.some((s, i) => restShown[i] && s.setType !== 'drop') ? [['Rest', PLAIN] as [string, string]] : []),
  ];
  // Four boxes (weight, reps, time and rest) don't fit a 700 px pane with the buttons, so the pane drops them there and
  // every box shares the width (the boxes still take typing).
  const many = columns.length > 3;
  const sizes = columns.map(([, size]) => (many ? PLAIN : size));
  const style = { '--set-cols': `40px 64px ${sizes.join(' ')} var(--ct-tap-min)` } as CSSProperties;
  return (
    <div className={styles.sets} style={style} data-many={many ? '' : undefined}>
      {stacked ? null : (
        <div className={styles.setColumns} aria-hidden="true">
          <span>Set</span>
          <span>Type</span>
          {columns.map(([caption]) => (
            <span key={caption}>{caption}</span>
          ))}
        </div>
      )}
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
          stacked={stacked}
        />
      ))}
    </div>
  );
}
