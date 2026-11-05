import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

/** Handwritten aside (Caveat, magenta, tilted). Real text, so screen readers read it. One per screen at most. */
export function HandNote({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...rest} className={cx(styles.handNote, className)} />;
}
