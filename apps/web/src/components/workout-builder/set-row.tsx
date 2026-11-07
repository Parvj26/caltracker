'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import {
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
import { gridTemplate, setColumns } from './set-columns';
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
  /** 'W', '1', '2', or '↳' (from setLabels). */
  label: string;
  /** Accessible group name, e.g. "Barbell Squat set 1" or "Barbell Squat drop after set 3". */
  name: string;
  trackingType: TrackingType;
  units: Units;
  showRest: boolean;
  canRemove: boolean;
  errors: string[];
  onChange: (patch: SetPatch) => void;
  onAddDrop: (() => void) | null;
  onRemove: () => void;
};

export function SetRow({ set, label, name, trackingType, units, showRest, canRemove, errors, onChange, onAddDrop, onRemove }: Props) {
  const fields = targetFieldsFor(trackingType);
  const isDrop = set.setType === 'drop';
  const distanceUnit = distanceUnitFor(units);
  const [range, setRange] = useState(
    set.targetRepsMin !== null && set.targetRepsMax !== null && set.targetRepsMin !== set.targetRepsMax,
  );
  const toggleHintId = useId();
  const toggleHint = range ? 'Use one rep count' : 'Use a rep range, e.g. 8–10';

  return (
    <div role="group" aria-label={name} className={cx(styles.setRow, isDrop && styles.dropRow)}>
      <div className={styles.setCells} style={{ gridTemplateColumns: gridTemplate(setColumns(trackingType, showRest)) }}>
        <span className={styles.setLabel} aria-hidden="true">{label}</span>

        {isDrop ? (
          <span className={styles.dropTag}>Drop</span>
        ) : (
          <select
            aria-label="Set type"
            className={cx(styles.input, styles.typeSelect)}
            value={set.setType}
            onChange={(e) => onChange({ setType: e.target.value === 'warmup' ? 'warmup' : 'normal' })}
          >
            <option value="normal">Normal</option>
            <option value="warmup">Warm-up</option>
          </select>
        )}

        {fields.includes('reps') ? (
          <div className={styles.reps} data-caption="Reps">
            {range ? (
              <>
                <NumberInput
                  label="Min reps"
                  inputMode="numeric"
                  placeholder="min"
                  className={styles.rangeInput}
                  value={set.targetRepsMin}
                  format={String}
                  parse={parseWhole}
                  onCommit={(n) => onChange({ targetRepsMin: n })}
                />
                <span aria-hidden="true">–</span>
                <NumberInput
                  label="Max reps"
                  inputMode="numeric"
                  placeholder="max"
                  className={styles.rangeInput}
                  value={set.targetRepsMax}
                  format={String}
                  parse={parseWhole}
                  onCommit={(n) => onChange({ targetRepsMax: n })}
                />
              </>
            ) : (
              <NumberInput
                label="Reps"
                inputMode="numeric"
                placeholder="reps"
                className={styles.narrow}
                value={set.targetRepsMin ?? set.targetRepsMax}
                format={String}
                parse={parseWhole}
                onCommit={(n) => onChange({ targetRepsMin: n, targetRepsMax: n })}
              />
            )}
            {/* Its label says what it switches to ("8–10" for a range, "Single" for one count), so no aria-pressed. */}
            <button
              type="button"
              className={cx(styles.smallButton, styles.toggle)}
              title={toggleHint}
              aria-describedby={toggleHintId}
              onClick={() => {
                // Leaving range mode keeps one number: the minimum.
                if (range) onChange({ targetRepsMax: set.targetRepsMin ?? set.targetRepsMax, targetRepsMin: set.targetRepsMin ?? set.targetRepsMax });
                setRange(!range);
              }}
            >
              {range ? 'Single' : '8–10'}
            </button>
            <span id={toggleHintId} className={styles.visuallyHidden}>
              {toggleHint}
            </span>
          </div>
        ) : null}

        {fields.includes('weight') ? (
          <label className={styles.unitField} data-caption="Weight">
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
            <span aria-hidden="true">{units}</span>
          </label>
        ) : null}

        {fields.includes('duration') ? (
          <label className={styles.unitField} data-caption="Time">
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
          </label>
        ) : null}

        {fields.includes('distance') ? (
          <label className={styles.unitField} data-caption="Distance">
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
            <span aria-hidden="true">{distanceUnit}</span>
          </label>
        ) : null}

        {isDrop ? (
          <label className={styles.check}>
            <input type="checkbox" checked={set.toFailure} onChange={(e) => onChange({ toFailure: e.target.checked })} />
            To failure
          </label>
        ) : showRest ? (
          <label className={styles.unitField} data-caption="Rest">
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
          </label>
        ) : (
          // This exercise has no rest (it runs straight into the next one): keep the column's place.
          <span />
        )}

        <input
          type="text"
          aria-label="Note"
          placeholder="Note"
          maxLength={500}
          className={cx(styles.input, styles.noteInput)}
          value={set.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value === '' ? null : e.target.value })}
        />

        <div className={styles.rowActions}>
          {onAddDrop ? (
            <button type="button" className={styles.smallButton} onClick={onAddDrop}>
              + Drop
            </button>
          ) : null}
          <button
            type="button"
            className={styles.smallButton}
            aria-label={isDrop ? 'Remove drop' : 'Remove set'}
            disabled={!canRemove}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      {errors.map((message) => (
        <ErrorText key={message} className={styles.rowError}>
          {message}
        </ErrorText>
      ))}
    </div>
  );
}
