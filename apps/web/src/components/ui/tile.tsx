import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

export type Tone = 'lime' | 'pink' | 'blue' | 'grey';

export type TileProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: Tone;
  label: ReactNode;
  value: ReactNode;
  /** The caption (`label`) is fixed product copy: shown in session recordings. The value (a number) stays hidden. */
  phSafe?: boolean;
};

/** Pastel stat tile: caption plus big number. Text on pastels is always ink. */
export function Tile({ tone, label, value, phSafe = false, className, ...rest }: TileProps) {
  return (
    <div {...rest} className={cx(styles.tile, styles[`tone-${tone}`], className)}>
      <p className={styles.tileLabel} data-ph-safe={phSafe ? '' : undefined}>{label}</p>
      <p className={styles.tileValue}>{value}</p>
    </div>
  );
}
