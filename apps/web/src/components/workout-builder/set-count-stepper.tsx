'use client';

import { useId } from 'react';
import { MAX_SETS } from '@caltracker/shared';
import styles from './set-count-stepper.module.css';

type Props = {
  /** "Sets each" or "Rounds". */
  label: string;
  /** "sets" or "rounds", for the buttons' names ("Fewer sets"). */
  noun: string;
  value: number;
  onChange: (n: number) => void;
};

/** "Sets each: − 3 +": how many sets each picked exercise starts with (1 to 20). */
export function SetCountStepper({ label, noun, value, onChange }: Props) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className={styles.stepper}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <button
        type="button"
        className={styles.button}
        aria-label={`Fewer ${noun}`}
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        −
      </button>
      <output aria-live="polite" aria-label={`${value} ${noun}`} className={styles.value}>
        {value}
      </output>
      <button
        type="button"
        className={styles.button}
        aria-label={`More ${noun}`}
        disabled={value >= MAX_SETS}
        onClick={() => onChange(Math.min(MAX_SETS, value + 1))}
      >
        +
      </button>
    </div>
  );
}
