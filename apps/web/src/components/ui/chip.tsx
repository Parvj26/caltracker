import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import type { Tone } from './tile';
import styles from './ui.module.css';

/** Pastel fills, plus `amber`: an amber outline on white for warnings (the words carry the meaning, not the colour). */
export type ChipTone = Tone | 'amber';

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
  /** Let a long label wrap onto several lines instead of staying on one. */
  wrap?: boolean;
};

export function Chip({ tone = 'grey', wrap = false, className, ...rest }: ChipProps) {
  return <span {...rest} className={cx(styles.chip, styles[`tone-${tone}`], wrap && styles.chipWrap, className)} />;
}
