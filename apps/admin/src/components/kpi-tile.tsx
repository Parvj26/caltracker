import type { ReactNode } from 'react';
import styles from './admin.module.css';

/** Overview and coach number tile: caps label, big value, one muted line. */
export function KpiTile({ label, value, note, tone = 'white' }: { label: string; value: ReactNode; note: ReactNode; tone?: 'lime' | 'white' | 'cream' }) {
  return (
    <div className={`${styles.tile} ${tone === 'white' ? '' : styles[`tile-${tone}`]}`}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileNote}>{note}</span>
    </div>
  );
}
