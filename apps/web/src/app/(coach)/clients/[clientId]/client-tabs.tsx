'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui/cx';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import styles from './client-page.module.css';

export const CLIENT_TABS = [
  { segment: null, path: '', label: 'Overview' },
  { segment: 'training', path: '/training', label: 'Training' },
  { segment: 'body', path: '/body', label: 'Body' },
  { segment: 'food', path: '/food', label: 'Food' },
  { segment: 'documents', path: '/documents', label: 'Documents' },
] as const;

type More = { before: boolean; after: boolean };

/**
 * Marks which ends of a sideways-scrolling strip have more behind them (data-more-before / data-more-after), so the
 * CSS can fade that edge and the coach can see there are more tabs. The same answer comes back as state for the
 * arrow buttons.
 */
function useScrollHints<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [more, setMore] = useState<More>({ before: false, after: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mark = (): More => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { before: el.scrollLeft > 1, after: el.scrollLeft < max - 1 };
      el.toggleAttribute('data-more-before', next.before);
      el.toggleAttribute('data-more-after', next.after);
      return next;
    };
    const update = () => {
      const next = mark();
      setMore((m) => (m.before === next.before && m.after === next.after ? m : next));
    };
    mark();
    el.addEventListener('scroll', update, { passive: true });
    // Also fires once straight away, which sets the state for the first time.
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, []);
  return { ref, more };
}

/**
 * The client page's tabs. Each is a link to its own address, so back, reload and shared links all work. Settings is
 * not a tab: it opens from the bar's "⋯" (its page, /settings, has no current tab).
 */
export function ClientTabs({ clientId }: { clientId: string }) {
  const segment = useSelectedLayoutSegment();
  const { ref, more } = useScrollHints<HTMLElement>();
  // The current tab is always in view, also when it is Documents on a phone.
  useEffect(() => {
    // Only the strip scrolls (scrollIntoView could also move the page, e.g. away from a #heading it opened at).
    const strip = ref.current;
    const tab = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !tab) return;
    const left = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 48);
    else if (left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = left + tab.offsetWidth - strip.clientWidth + 48;
  }, [ref, segment]);
  // Opening a tab at a #heading (Overview's "See bests and stickers"): scroll it into view once the tab is on screen,
  // so its scroll margin keeps it below the bar stuck at the top on a phone (Mobile Safari's own jump can land under it).
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [segment]);
  const page = (direction: 1 | -1) => {
    const strip = ref.current;
    if (strip) strip.scrollBy({ left: direction * Math.round(strip.clientWidth * 0.7), behavior: 'smooth' });
  };
  return (
    <div className={styles.tabsWrap}>
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
      {/* Arrows on a faded edge, only while tabs are hidden behind it (a narrow window). Phones hide them in CSS: the
          strip is swiped there, and the fade shows there is more. A mouse can tap them; keyboard and screen reader
          users reach every tab as a link anyway, so the arrows stay out of their way. */}
      {more.before ? (
        <button type="button" className={cx(styles.tabsArrow, styles.tabsArrowBefore)} onClick={() => page(-1)} aria-hidden="true" tabIndex={-1} data-testid="client-tabs-before">
          <ChevronIcon direction="left" size={18} />
        </button>
      ) : null}
      {more.after ? (
        <button type="button" className={cx(styles.tabsArrow, styles.tabsArrowAfter)} onClick={() => page(1)} aria-hidden="true" tabIndex={-1} data-testid="client-tabs-after">
          <ChevronIcon direction="right" size={18} />
        </button>
      ) : null}
    </div>
  );
}
