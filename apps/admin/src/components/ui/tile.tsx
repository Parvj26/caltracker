import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

export type Tone = 'lime' | 'pink' | 'blue' | 'grey';

export type TileProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  tone: Tone;
  label: ReactNode;
  value: ReactNode;
};

/** Pastel stat tile: caption plus big number. Text on pastels is always ink. */
export function Tile({ tone, label, value, className, ...rest }: TileProps) {
  return (
    <div {...rest} className={cx(styles.tile, styles[`tone-${tone}`], className)}>
      <p className={styles.tileLabel}>{label}</p>
      <p className={styles.tileValue}>{value}</p>
    </div>
  );
}
