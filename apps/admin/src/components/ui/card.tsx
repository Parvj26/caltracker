import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx(styles.card, className)} />;
}
