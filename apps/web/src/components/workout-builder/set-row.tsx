'use client';

import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  setKindOf,
  setKindPatch,
  singleReps,
  targetFieldsFor,
  distanceUnitFor,
  formatClock,
  fromMeters,
  kgToInput,
  parseClock,
  toKg,
  toMeters,
} from '@caltracker/shared';
import type { TrackingType, Units, WorkoutSetDoc } from '@caltracker/shared';
import { ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { Icon } from './icons';
import { SetTypeMenu } from './set-type-menu';
import styles from './builder.module.css';

export type SetPatch = Partial<Omit<WorkoutSetDoc, 'id'>>;

/** Blank text is null; text that is not a number is NaN (kept in the box, not saved). */
function parseDecimal(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

function parseWhole(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string;
  value: number | null;
  format: (n: number) => string;
  parse: (text: string) => number | null;
  onCommit: (n: number | null) => void;
};

/**
 * A text box for a number. While the coach types, the box shows exactly what they typed (so "61." or "1:" are not
 * rewritten mid-entry); each readable value is saved to the doc at once. On blur it shows the doc's value again.
 */
function NumberInput({ label, value, format, parse, onCommit, className, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && Number.isNaN(parse(draft));
  return (
    <input
      {...rest}
      type="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={cx(styles.input, className)}
      value={draft ?? (value === null ? '' : format(value))}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const n = parse(text);
        if (n === null || !Number.isNaN(n)) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

type Props = {
  set: WorkoutSetDoc;
  /** The row's place in the exercise, from 1 (every row counts: warm-ups and drops too). */
  number: number;
  /** Accessible group name, e.g. "Barbell Squat set 2". */
  name: string;
  trackingType: TrackingType;
  units: Units;
  /** False in a superset for an exercise that goes straight on to the next one (no rest box). */
  showRest: boolean;
  canRemove: boolean;
  /** False on the first row: a drop must follow a set. */
  canDrop: boolean;
  errors: string[];
  onChange: (patch: SetPatch) => void;
  onRemove: () => void;
};

/** One labelled box in a set row: a small caption above it, as in the approved mockup. */
function Field({ caption, col, children }: { caption: string; col: string; children: ReactNode }) {
  return (
    <div className={styles.field} data-col={col}>
      <span className={styles.fieldCaption} aria-hidden="true">
        {caption}
      </span>
      <span className={styles.fieldBox}>{children}</span>
    </div>
  );
}

/**
 * One set (see SetTable for the two layouts): its number, its type letter (W / N / F / D, see SetTypeMenu), one rep count (or weight, time or distance,
 * as the exercise's tracking type needs) and rest. A drop is indented under the set above and has no rest of its own.
 * The × in the corner removes it.
 */
export function SetRow({ set, number, name, trackingType, units, showRest, canRemove, canDrop, errors, onChange, onRemove }: Props) {
  const fields = targetFieldsFor(trackingType);
  const kind = setKindOf(set);
  const isDrop = set.setType === 'drop';
  const distanceUnit = distanceUnitFor(units);

  return (
    <div role="group" aria-label={name} className={cx(styles.setRow, isDrop && styles.dropRow)}>
      <div className={styles.setCells}>
        <span className={styles.setLabel} aria-hidden="true">
          {number}
        </span>
        <div className={styles.field} data-col="type">
          <span className={styles.fieldCaption} aria-hidden="true">
            Type
          </span>
          <SetTypeMenu kind={kind} setName={name} canDrop={canDrop} onPick={(k) => onChange(setKindPatch(k))} />
        </div>

        {fields.includes('reps') ? (
          <Field caption="Reps" col="reps">
            <NumberInput
              label="Reps"
              inputMode="numeric"
              placeholder={set.toFailure ? 'max' : 'reps'}
              className={styles.narrow}
              value={singleReps(set.targetRepsMin, set.targetRepsMax)}
              format={String}
              parse={parseWhole}
              onCommit={(n) => onChange({ targetRepsMin: n, targetRepsMax: n })}
            />
          </Field>
        ) : null}

        {fields.includes('weight') ? (
          <Field caption="Weight" col="weight">
            <NumberInput
              label={`Weight (${units})`}
              inputMode="decimal"
              placeholder={units}
              className={styles.narrow}
              value={set.targetWeightKg}
              format={(kg) => String(kgToInput(kg, units))}
              parse={parseDecimal}
              onCommit={(n) => onChange({ targetWeightKg: n === null ? null : toKg(n, units) })}
            />
            <span className={styles.unit} aria-hidden="true">{units}</span>
          </Field>
        ) : null}

        {fields.includes('duration') ? (
          <Field caption="Time" col="duration">
            <NumberInput
              label="Duration (m:ss)"
              inputMode="numeric"
              placeholder="m:ss"
              className={styles.narrow}
              value={set.targetDurationS}
              format={formatClock}
              parse={parseClock}
              onCommit={(n) => onChange({ targetDurationS: n })}
            />
          </Field>
        ) : null}

        {fields.includes('distance') ? (
          <Field caption="Distance" col="distance">
            <NumberInput
              label={`Distance (${distanceUnit})`}
              inputMode="decimal"
              placeholder={distanceUnit}
              className={styles.narrow}
              value={set.targetDistanceM}
              format={(m) => String(fromMeters(m, distanceUnit))}
              parse={parseDecimal}
              onCommit={(n) => onChange({ targetDistanceM: n === null ? null : toMeters(n, distanceUnit) })}
            />
            <span className={styles.unit} aria-hidden="true">{distanceUnit}</span>
          </Field>
        ) : null}

        {/* A drop goes straight on from the set above, so it has no rest; nor does a superset exercise that runs
            straight into the next one. */}
        {showRest && !isDrop ? (
          <Field caption="Rest" col="rest">
            <NumberInput
              label="Rest (m:ss)"
              inputMode="numeric"
              placeholder="m:ss"
              className={styles.narrow}
              value={set.restSeconds}
              format={formatClock}
              parse={parseClock}
              onCommit={(n) => onChange({ restSeconds: n ?? 0 })}
            />
          </Field>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.removeSet}
        aria-label={`Remove set ${number}`}
        title={canRemove ? 'Remove set' : 'An exercise keeps at least one set'}
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Icon name="close" size={18} />
      </button>
      {errors.map((message) => (
        <ErrorText key={message} className={styles.rowError}>
          {message}
        </ErrorText>
      ))}
    </div>
  );
}
