'use client';

import { MEASUREMENTS, MEASUREMENT_NAMES, canPickMeasurements, measurementsLabel, measurementsOf } from '@caltracker/shared';
import type { Measurement, TrackingType } from '@caltracker/shared';
import styles from './builder.module.css';

type Props = {
  trackingType: TrackingType;
  exerciseName: string;
  onToggle: (m: Measurement) => void;
  /** The Rest checkbox: null when no set of the exercise has a rest (it goes straight on in a superset). */
  rest: boolean | null;
  onToggleRest: (on: boolean) => void;
};


/**
 * What an exercise measures, on every size (rulebook §9.5): one toggle chip each ("✓ Weight", "+ Time", "✓ Rest").
 * The set columns follow; the last of Weight, Reps and Time can't be turned off. A distance exercise keeps its kind,
 * so it offers only Rest.
 */
export function MeasurementChips({ trackingType, exerciseName, onToggle, rest, onToggleRest }: Props) {
  const pickable = canPickMeasurements(trackingType);
  const on = measurementsOf(trackingType) ?? [];
  const chip = (key: string, name: string, pressed: boolean, disabled: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      className={styles.measureChip}
      aria-pressed={pressed}
      aria-label={`${name} for ${exerciseName}`}
      title={disabled ? 'Pick at least one' : name === 'Rest' ? "Rest off: no rest column, and no rest on the client's phone after this exercise." : undefined}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
    >
      <span aria-hidden="true">{pressed ? '✓' : '+'}</span> {name}
    </button>
  );
  return (
    <div role="group" aria-label={`Measurements for ${exerciseName}`} className={styles.measureChips}>
      {pickable
        ? MEASUREMENTS.map((m) => {
            const pressed = on.includes(m);
            return chip(m, MEASUREMENT_NAMES[m], pressed, pressed && on.length === 1, () => onToggle(m));
          })
        : <span className={styles.caption}>{measurementsLabel(trackingType)}</span>}
      {rest !== null ? chip('rest', 'Rest', rest, false, () => onToggleRest(!rest)) : null}
    </div>
  );
}
