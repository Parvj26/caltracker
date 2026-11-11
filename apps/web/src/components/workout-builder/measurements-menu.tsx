'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MEASUREMENTS, MEASUREMENT_NAMES, canPickMeasurements, measurementsLabel, measurementsOf } from '@caltracker/shared';
import type { Measurement, TrackingType } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { Icon } from './icons';
import styles from './builder.module.css';

/**
 * The measurements tab: a pill with what the exercise measures here ("Weight · Reps ⌄"). Tapping it opens the
 * "Measurements" popover with a checkbox for Weight, Reps and Time; the set columns follow. The last ticked one
 * can't be unticked. A distance exercise keeps its kind, so it shows a plain label instead.
 */
export function MeasurementsMenu({
  trackingType,
  exerciseName,
  onToggle,
}: {
  trackingType: TrackingType;
  exerciseName: string;
  onToggle: (m: Measurement) => void;
}) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const label = measurementsLabel(trackingType);

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  if (!canPickMeasurements(trackingType)) return <span className={styles.caption}>{label}</span>;
  const on = measurementsOf(trackingType) ?? [];

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div ref={wrapRef} className={styles.measureWrap}>
      <button
        type="button"
        ref={buttonRef}
        className={cx(styles.measurePill, open && styles.measurePillOpen)}
        aria-label={`Measurements: ${label}`}
        title="What this exercise measures"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <Icon name="chevron" size={16} />
      </button>
      {open ? (
        <div id={popId} role="dialog" aria-label={`Measurements for ${exerciseName}`} className={styles.measureMenu} onKeyDown={onKey}>
          <span className={styles.measureTitle} aria-hidden="true">
            Measurements
          </span>
          {MEASUREMENTS.map((m, i) => {
            const checked = on.includes(m);
            const last = checked && on.length === 1;
            return (
              <label key={m} className={styles.measureItem} title={last ? 'Pick at least one' : undefined}>
                <input
                  ref={i === 0 ? firstRef : undefined}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={checked}
                  disabled={last}
                  onChange={() => onToggle(m)}
                />
                {MEASUREMENT_NAMES[m]}
              </label>
            );
          })}
          <p className={styles.measureHint}>Pick at least one. The table shows a column for each.</p>
        </div>
      ) : null}
    </div>
  );
}
