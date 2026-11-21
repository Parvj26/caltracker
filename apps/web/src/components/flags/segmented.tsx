'use client';

import { useId } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './flags.module.css';

/**
 * A segmented choice as a radio group (UI rules §2.3: the chosen one is a white pill with an ink border). Arrow keys
 * move between options, as for any radio group.
 */
export function Segmented({
  label,
  options,
  value,
  onChange,
  compact = false,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const name = useId();
  const labelId = `${name}-label`;
  return (
    <div className={cx(styles.segmentField, compact && styles.segmentCompact)}>
      {compact ? null : (
        <span id={labelId} className={styles.segmentLabel} data-ph-safe="">
          {label}
        </span>
      )}
      <div role="radiogroup" aria-labelledby={compact ? undefined : labelId} aria-label={compact ? label : undefined} className={styles.segments}>
        {options.map((o) => (
          <label key={o.value} className={styles.segment} data-ph-safe="">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className={styles.segmentInput} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
