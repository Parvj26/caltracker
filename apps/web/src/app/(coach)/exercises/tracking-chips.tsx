'use client';

import { TRACKING_TYPES } from '@caltracker/shared';
import { Chip } from '@/components/ui';
import { TRACKING_LABELS } from './filters';
import styles from './exercises.module.css';

/** Tracking-type filter as toggle chips; pressing the pressed one again clears it. */
export function TrackingChips({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div role="group" aria-label="Tracking type" className={styles.chipGroup}>
      <span aria-hidden="true" className={styles.chipGroupLabel}>Tracking type</span>
      <div className={styles.chipRow}>
        {TRACKING_TYPES.map((t) => {
          const pressed = value === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={pressed}
              className={styles.chipButton}
              onClick={() => onChange(pressed ? '' : t)}
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
