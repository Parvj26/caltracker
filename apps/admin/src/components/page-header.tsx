import type { ReactNode } from 'react';
import styles from './admin.module.css';

/** Page title with an optional subtitle and something on the right (search box, View as). */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.header}>
      <span className={styles.headerText}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {children}
    </div>
  );
}
