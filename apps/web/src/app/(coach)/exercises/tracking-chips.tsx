'use client';

import { useRef, useState } from 'react';
import { TRACKING_TYPES } from '@caltracker/shared';
import { Chip } from '@/components/ui';
import { TRACKING_LABELS } from './filters';
import styles from './exercises.module.css';

/** Tracking-type filter as toggle chips. Pressing one submits the surrounding GET form; pressing it again clears it. */
export function TrackingChips({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const hidden = useRef<HTMLInputElement>(null);

  function toggle(type: string, button: HTMLButtonElement) {
    const next = value === type ? '' : type;
    setValue(next);
    if (hidden.current) hidden.current.value = next;
    button.form?.requestSubmit();
  }

  return (
    <div role="group" aria-label="Tracking type" className={styles.chipGroup}>
      <span aria-hidden="true" className={styles.chipGroupLabel}>Tracking type</span>
      <input ref={hidden} type="hidden" name="tracking" defaultValue={initial} />
      <div className={styles.chipRow}>
        {TRACKING_TYPES.map((t) => {
          const pressed = value === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={pressed}
              className={styles.chipButton}
              onClick={(e) => toggle(t, e.currentTarget)}
            >
              <Chip tone={pressed ? 'lime' : 'grey'} className={pressed ? styles.chipOn : undefined}>
                {TRACKING_LABELS[t]}
              </Chip>
            </button>
          );
        })}
      </div>
    </div>
  );
}
