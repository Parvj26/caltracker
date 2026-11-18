'use client';

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

/** An exercise's sets: each a small card with a caption above each box (iPad, desktop), or stacked on a phone. */
export function SetTable({ sets, names, trackingType, units, restShown, errors, onUpdate, onRemove, stacked = false }: Props) {
  return (
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
          stacked={stacked}
        />
      ))}
    </div>
  );
}
