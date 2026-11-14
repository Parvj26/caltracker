'use client';

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { quickDays, type IsoDate } from '@caltracker/shared';
import { TextField, errorFromText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import styles from './assign.module.css';

export type QuickDayPickerHandle = { openField: () => void };

/**
 * A day chooser for the pop-up windows: quick days first (Today, Tomorrow, the next weekdays, Next Mon), then
 * "Pick a date…" opens the date field. The field shows straight away when the chosen day isn't one of the quick days.
 * With `workoutsOn`, each quick day says how busy it is.
 */
export function QuickDayPicker({
  legend,
  today,
  value,
  onChange,
  min,
  exclude,
  workoutsOn,
  fieldLabel = 'Date',
  fieldMin,
  inputId,
  error,
  ref,
}: {
  legend: string;
  today: IsoDate;
  value: string;
  onChange: (date: string) => void;
  /** The earliest quick day (default today). */
  min?: IsoDate;
  exclude?: readonly IsoDate[];
  workoutsOn?: (date: IsoDate) => number;
  fieldLabel?: string;
  /** The date field's own minimum (a program may start up to a week back). */
  fieldMin: IsoDate;
  inputId?: string;
  error?: string | null;
  ref?: Ref<QuickDayPickerHandle>;
}) {
  const days = quickDays(today, { ...(min ? { min } : {}), ...(exclude ? { exclude } : {}), ...(workoutsOn ? { workoutsOn } : {}) });
  const [fieldOpen, setFieldOpen] = useState(false);
  const focusField = useRef(false);
  const autoId = useId();
  const fieldId = inputId ?? autoId;
  const focus = () => document.getElementById(fieldId)?.focus();
  const showField = fieldOpen || !days.some((d) => d.date === value);

  useImperativeHandle(ref, () => ({
    openField: () => {
      focusField.current = true;
      setFieldOpen(true);
      focus();
    },
  }));
  useEffect(() => {
    if (!fieldOpen || !focusField.current) return;
    focusField.current = false;
    document.getElementById(fieldId)?.focus();
  }, [fieldOpen, fieldId]);

  return (
    <fieldset className={styles.quickDays}>
      <legend className={styles.quickLegend}>{legend}</legend>
      <div className={styles.dayChips}>
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={cx(styles.dayChip, d.busy !== undefined && d.busy > 0 && styles.dayChipBusy)}
            aria-pressed={d.date === value}
            onClick={() => onChange(d.date)}
          >
            <span className={styles.dayChipLabel}>{d.label}</span>
            <small className={styles.dayChipDetail}>{d.detail}</small>
          </button>
        ))}
      </div>
      {showField ? (
        <TextField
          id={fieldId}
          label={fieldLabel}
          type="date"
          min={fieldMin}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(error ? { error: errorFromText(error, 'assign_date_invalid') } : {})}
        />
      ) : (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            focusField.current = true;
            setFieldOpen(true);
          }}
        >
          Pick a date…
        </button>
      )}
    </fieldset>
  );
}
