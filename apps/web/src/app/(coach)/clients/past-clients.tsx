'use client';

import { useState, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './clients.module.css';

/** "Past clients (N)", folded by default: the rows are rendered by the page and passed in. */
export function PastClients({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="past-heading" className={styles.pastSection}>
      <h2 className={styles.sectionHeading}>
        <button
          type="button"
          id="past-heading"
          className={styles.csvToggle}
          aria-expanded={open}
          aria-controls="past-body"
          onClick={() => setOpen((o) => !o)}
        >
          {`Past clients (${count})`}
        </button>
      </h2>
      <div id="past-body" className={cx(styles.csvBody)} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
