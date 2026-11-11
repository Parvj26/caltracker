'use client';

import type { CSSProperties } from 'react';
import { setColumns } from '@caltracker/shared';
import type { TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { SetRow, type SetPatch } from './set-row';
import styles from './builder.module.css';

type Props = {
  sets: readonly WorkoutSetDoc[];
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
 * An exercise's sets. One markup for both layouts: on a wide screen each set is a small card with a caption above
 * each box (the header row is hidden); below 600 px it becomes one table, a header row (SET | LB | REPS | REST,
 * following the measurements) and one thin row per set with the × at the end. builder.module.css does the switch.
 */
export function SetTable({ sets, names, trackingType, units, restShown, errors, onUpdate, onRemove }: Props) {
  const columns = setColumns(trackingType, units);
  const anyRest = sets.some((s, i) => restShown[i] && s.setType !== 'drop');
  const style = { '--set-cols': columns.length + (anyRest ? 1 : 0) } as CSSProperties;
  return (
    <div className={styles.sets} style={style}>
      <div className={styles.setHeader} aria-hidden="true">
        <span>SET</span>
        {columns.map((c) => (
          <span key={c.field}>{c.heading}</span>
        ))}
        {anyRest ? <span>REST</span> : null}
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
          canRemove={sets.length > 1}
          canDrop={si > 0}
          errors={errors.get(`set:${s.id}`) ?? []}
          onChange={(patch) => onUpdate(s.id, patch)}
          onRemove={() => onRemove(s.id)}
        />
      ))}
    </div>
  );
}
