'use client';

import { MUSCLE_CHIPS, MUSCLE_CHIP_MUSCLES } from '@caltracker/shared';
import { useId } from 'react';
import { EQUIPMENT } from './filters';
import styles from './exercises.module.css';

/**
 * Fixed choices as one chip control (rulebook §9.5): muscles (pick any) and equipment (pick one). No free text, so a
 * custom exercise always matches the filter chips. Storage stays the same text values (the free-exercise-db names); a
 * value saved before that isn't in the list still shows as a chip, ticked, so editing never drops it.
 */

/** The library's muscle names, grouped like the filter chips (Chest, Back…), plus "other". */
export const MUSCLE_CHOICES: readonly string[] = [...MUSCLE_CHIPS.flatMap((chip) => MUSCLE_CHIP_MUSCLES[chip]), 'other'];
export const EQUIPMENT_CHOICES: readonly string[] = EQUIPMENT;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The choices, then any saved value that isn't one of them (kept as it is). */
export function choicesWith(choices: readonly string[], saved: readonly string[]): string[] {
  const known = new Set(choices);
  return [...choices, ...saved.filter((v, i) => !known.has(v) && saved.indexOf(v) === i)];
}

export function ChoiceChips({
  label,
  name,
  choices,
  value,
  multiple,
  onChange,
}: {
  label: string;
  /** The form field it fills: a hidden input with the picks joined by commas. */
  name: string;
  choices: readonly string[];
  value: string[];
  /** Pick any (muscles). Otherwise pick one, and pressing it again clears it (equipment is optional). */
  multiple: boolean;
  onChange: (next: string[]) => void;
}) {
  const labelId = useId();
  const shown = choicesWith(choices, value);
  return (
    <div role="group" aria-labelledby={labelId} className={styles.choiceGroup}>
      <span id={labelId} className={styles.choiceLabel}>
        {label}
      </span>
      <div className={styles.choiceRow}>
        {shown.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              className={styles.pill}
              onClick={() => onChange(on ? value.filter((v) => v !== c) : multiple ? [...value, c] : [c])}
            >
              {on ? <span aria-hidden="true">✓ </span> : null}
              {capital(c)}
            </button>
          );
        })}
      </div>
      <input type="hidden" name={name} value={value.join(',')} />
    </div>
  );
}
