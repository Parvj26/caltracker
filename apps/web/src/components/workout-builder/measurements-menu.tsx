'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MEASUREMENTS, MEASUREMENT_NAMES, canPickMeasurements, measurementsLabel, measurementsOf } from '@caltracker/shared';
import type { Measurement, TrackingType } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import { Icon } from './icons';
import styles from './builder.module.css';
import { useBackLayer } from '@/lib/open-layer';

type Props = {
  trackingType: TrackingType;
  exerciseName: string;
  onToggle: (m: Measurement) => void;
  /** The Rest checkbox: null when no set of the exercise has a rest (it goes straight on in a superset). */
  rest: boolean | null;
  onToggleRest: (on: boolean) => void;
};

const restHint = "Rest off: no rest column, and no rest on the client's phone after this exercise.";

/**
 * The measurements tab: a pill with what the exercise measures here ("Weight · Reps · Rest ⌄"). Tapping it opens
 * the "Measurements" popover with a checkbox for Weight, Reps and Time (the set columns follow; the last ticked one
 * can't be unticked) and, below them, Rest. A distance exercise keeps its kind, so it offers only Rest.
 */
export function MeasurementsMenu({ trackingType, exerciseName, onToggle, rest, onToggleRest }: Props) {
  const [open, setOpen] = useState(false);
  // Back (and iOS swipe-back) closes the menu, not the page.
  useBackLayer(open, () => setOpen(false));
  const popId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const label = `${measurementsLabel(trackingType)}${rest ? ' · Rest' : ''}`;

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const pickable = canPickMeasurements(trackingType);
  if (!pickable && rest === null) return <span className={styles.caption}>{label}</span>;
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
          {(pickable ? MEASUREMENTS : []).map((m, i) => {
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
          {pickable ? <p className={styles.measureHint}>Pick at least one. The table shows a column for each.</p> : null}
          {rest !== null ? (
            <>
              <label className={cx(styles.measureItem, pickable && styles.measureRest)}>
                <input
                  ref={pickable ? undefined : firstRef}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={rest}
                  onChange={(e) => onToggleRest(e.target.checked)}
                />
                Rest
              </label>
              <p className={styles.measureHint}>{restHint}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The phone editor's measurements: one toggle chip each ("✓ Weight", "+ Time", "✓ Rest"), same rules as the menu.
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
      title={disabled ? 'Pick at least one' : undefined}
      disabled={disabled}
      onClick={onClick}
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
