'use client';

import { useId, useState, type ReactNode } from 'react';
import styles from './view-as.module.css';

const TABS = ['Today', 'Workouts', 'Food', 'Progress'] as const;
type Tab = (typeof TABS)[number];

/**
 * The phone frame. Switching tabs only shows another part of the one snapshot already loaded: no requests, no
 * controls that change anything. The tabs are the only buttons.
 */
export function ViewAsFrame({ header, screens }: { header: ReactNode; screens: Record<Tab, ReactNode> }) {
  const [tab, setTab] = useState<Tab>('Today');
  const id = useId();
  return (
    <section aria-label="Client app (read-only)" className={styles.phone}>
      {header}
      {TABS.map((t) => (
        <div
          key={t}
          role="tabpanel"
          id={`${id}-${t}`}
          aria-labelledby={`${id}-${t}-tab`}
          hidden={tab !== t}
          className={styles.screen}
        >
          {screens[t]}
        </div>
      ))}
      <div role="tablist" aria-label="Screens" className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-${t}-tab`}
            aria-selected={tab === t}
            aria-controls={`${id}-${t}`}
            className={styles.tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}
