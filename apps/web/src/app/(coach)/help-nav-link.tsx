'use client';

import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { supportMailto } from '@caltracker/shared';
import { NAV_ICONS } from './nav-icons';
import styles from './coach.module.css';

const noSubscribe = () => () => {};

/**
 * The sidebar's "Help & feedback": an email to support, pre-filled with the website's release, the browser and the
 * page (origin and path only, never the query string). The browser details exist only in the browser, so the server
 * renders the link without them.
 */
export function HelpNavLink() {
  const pathname = usePathname();
  const device = useSyncExternalStore(noSubscribe, () => navigator.userAgent, () => 'unknown');
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => null);
  const href = supportMailto({
    surface: 'Coach website',
    release: process.env.NEXT_PUBLIC_RELEASE ?? 'dev',
    device,
    ...(origin ? { page: `${origin}${pathname}` } : {}),
  });
  return (
    <a href={href} data-ph-capture-attribute-label="help_feedback" aria-label="Help & feedback" title="Help & feedback" className={styles.navItem}>
      {NAV_ICONS.help}
      <span className={styles.navLabel}>Help &amp; feedback</span>
    </a>
  );
}
