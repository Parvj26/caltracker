'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import styles from './client-page.module.css';

export const CLIENT_TABS = [
  { segment: null, path: '', label: 'Overview' },
  { segment: 'training', path: '/training', label: 'Training' },
  { segment: 'body', path: '/body', label: 'Body' },
  { segment: 'documents', path: '/documents', label: 'Documents' },
  { segment: 'settings', path: '/settings', label: 'Settings' },
] as const;

/** The client page's tabs. Each is a link to its own address, so back, reload and shared links all work. */
export function ClientTabs({ clientId }: { clientId: string }) {
  const segment = useSelectedLayoutSegment();
  return (
    <nav aria-label="Client sections" className={styles.tabs}>
      <ul className={styles.tabList}>
        {CLIENT_TABS.map((t) => {
          const current = t.segment === segment;
          return (
            <li key={t.label}>
              <Link
                href={`/clients/${clientId}${t.path}`}
                aria-current={current ? 'page' : undefined}
                className={cx(styles.tab, current && styles.tabCurrent)}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
