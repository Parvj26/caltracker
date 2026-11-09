import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './ui.module.css';

/** Short note in bold deep magenta (the app font, easy to read). Real text, so screen readers read it. One per screen at most. */
export function HandNote({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...rest} className={cx(styles.handNote, className)} />;
}
