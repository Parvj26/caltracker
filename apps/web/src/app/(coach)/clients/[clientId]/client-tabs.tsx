'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './client-page.module.css';

export const CLIENT_TABS = [
  { segment: null, path: '', label: 'Overview' },
  { segment: 'training', path: '/training', label: 'Training' },
  { segment: 'body', path: '/body', label: 'Body' },
  { segment: 'food', path: '/food', label: 'Food' },
  { segment: 'documents', path: '/documents', label: 'Documents' },
  { segment: 'settings', path: '/settings', label: 'Settings' },
] as const;

/**
 * Marks which ends of a sideways-scrolling strip have more behind them (data-more-before / data-more-after), so the
 * CSS can fade that edge and the coach can see there are more tabs.
 */
function useScrollHints<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.toggleAttribute('data-more-before', el.scrollLeft > 1);
      el.toggleAttribute('data-more-after', el.scrollLeft < max - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, []);
  return ref;
}

/** The client page's tabs. Each is a link to its own address, so back, reload and shared links all work. */
export function ClientTabs({ clientId }: { clientId: string }) {
  const segment = useSelectedLayoutSegment();
  const ref = useScrollHints<HTMLElement>();
  // The current tab is always in view, also when it is Documents or Settings on a phone.
  useEffect(() => {
    // Only the strip scrolls (scrollIntoView could also move the page, e.g. away from a #heading it opened at).
    const strip = ref.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 48);
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth + 48;
  }, [ref, segment]);
  return (
    <nav ref={ref} aria-label="Client sections" className={styles.tabs}>
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
