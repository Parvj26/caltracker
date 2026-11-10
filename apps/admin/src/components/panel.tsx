import { useId, type ReactNode } from 'react';
import { cx } from './ui/cx';
import styles from './admin.module.css';

/** A bordered box with a heading; a named region, so tests and screen readers can find it by its title. */
export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(styles.panel, className)}>
      <h2 id={id} className={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  );
}
