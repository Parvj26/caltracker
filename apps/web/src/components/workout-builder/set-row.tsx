'use client';

import { useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
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
  stepReps,
  stepWeight,
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
export function parseDecimal(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
}

export function parseWhole(text: string): number | null {
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

/** Selects the whole box, so the next key replaces the number (10 → 8, not 108). */
function selectAll(el: HTMLInputElement) {
  if (document.activeElement === el) el.setSelectionRange(0, el.value.length);
}

/**
 * A text box for a number. While the coach types, the box shows exactly what they typed (so "61." or "1:" are not
 * rewritten mid-entry); each readable value is saved to the doc at once. On blur it shows the doc's value again.
 * Tapping or tabbing into a filled box selects its number, so typing replaces it instead of landing mid-number.
 */
export function NumberInput({ label, value, format, parse, onCommit, className, onFocus, onPointerDown, onPointerUp, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // True during a tap that focuses the box: Safari places the caret when that tap ends, undoing the selection.
  const focusingTap = useRef(false);
  const invalid = draft !== null && Number.isNaN(parse(draft));
  return (
    <input
      {...rest}
      onFocus={(e) => {
        onFocus?.(e);
        const el = e.currentTarget;
        // iOS ignores a selection made inside the focus event, so select once it has settled.
        setTimeout(() => selectAll(el), 0);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        focusingTap.current = document.activeElement !== e.currentTarget;
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        if (!focusingTap.current) return;
        // A second tap in a box that already has focus still places the caret, as usual.
        focusingTap.current = false;
        const el = e.currentTarget;
        requestAnimationFrame(() => selectAll(el));
      }}
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

/**
 * − and + on either side of a box (phones, iPads and other touch screens; hidden on a desktop with a mouse). Typing
 * still works; each tap changes the doc at once. 44 px tall, spaced apart.
 */
function Stepper({ less, more, onStep, children }: { less: string; more: string; onStep: (dir: 1 | -1) => void; children: ReactNode }) {
  return (
    <span className={styles.stepper}>
      <button type="button" className={styles.stepButton} aria-label={less} onClick={() => onStep(-1)} data-ph-capture-attribute-label="workout_step_down">
        <span aria-hidden="true">−</span>
      </button>
      {children}
      <button type="button" className={styles.stepButton} aria-label={more} onClick={() => onStep(1)} data-ph-capture-attribute-label="workout_step_up">
        <span aria-hidden="true">+</span>
      </button>
    </span>
  );
}

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
    // data-values: how many value boxes the row has, so a phone's two-line layout knows which boxes wrap to line 2.
    <div role="group" aria-label={name} className={cx(styles.setRow, isDrop && styles.dropRow)} data-values={fields.length}>
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
            <Stepper
              less="Fewer reps"
              more="More reps"
              onStep={(dir) => {
                const n = stepReps(singleReps(set.targetRepsMin, set.targetRepsMax), dir);
                onChange({ targetRepsMin: n, targetRepsMax: n });
              }}
            >
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
            </Stepper>
          </Field>
        ) : null}

        {fields.includes('weight') ? (
          <Field caption="Weight" col="weight">
            <Stepper
              less="Less weight"
              more="More weight"
              onStep={(dir) => onChange({ targetWeightKg: stepWeight(set.targetWeightKg, dir, units) })}
            >
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
            </Stepper>
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
        data-ph-capture-attribute-label="workout_remove_set"
        aria-label={`Remove set ${number}`}
        title={canRemove ? 'Remove set' : 'An exercise keeps at least one set'}
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Icon name="close" size={18} />
      </button>
      {errors.map((message) => (
        <ErrorText key={message} code="workout_fields_invalid" safe={false} className={styles.rowError}>
          {message}
        </ErrorText>
      ))}
    </div>
  );
}
