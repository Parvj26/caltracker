import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import type { Tone } from './tile';
import styles from './ui.module.css';

export type ChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

export function Chip({ tone = 'grey', className, ...rest }: ChipProps) {
  return <span {...rest} className={cx(styles.chip, styles[`tone-${tone}`], className)} />;
}
