'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import styles from './link-row.module.css';

/** Clicks on these keep their own behaviour: the row's own link, its action buttons and any dialog they open. */
const OWN_CLICKS = 'a, button, input, select, textarea, label, summary, dialog, [data-row-actions]';

/**
 * A table row that opens `href` when tapped or clicked anywhere outside its controls, so the whole row works like
 * its name link. The name stays a real <Link> (the keyboard and screen-reader way in, and what the row's role and
 * cells are tested by); the action buttons stay separate controls, never inside a link. Ctrl/Cmd-click and
 * middle-click open a new tab, like a link. A click that ends a text selection doesn't open anything.
 */
export function LinkRow({ href, className, role, children }: { href: string; className?: string; role?: 'row'; children: ReactNode }) {
  const router = useRouter();
  const target = (event: MouseEvent<HTMLTableRowElement>) => {
    const el = event.target as HTMLElement;
    // Only clicks on the row itself: not ones bubbling up (through React) from a dialog shown elsewhere in the page.
    if (!event.currentTarget.contains(el) || el.closest(OWN_CLICKS)) return null;
    if (window.getSelection()?.toString()) return null;
    return href;
  };
  return (
    <tr
      // An explicit role keeps it a row for screen readers when CSS lays the table out as cards.
      role={role}
      className={cx(styles.row, className)}
      onClick={(event) => {
        const to = target(event);
        if (!to) return;
        if (event.metaKey || event.ctrlKey) window.open(to, '_blank', 'noopener');
        else router.push(to);
      }}
      onAuxClick={(event) => {
        const to = event.button === 1 ? target(event) : null;
        if (!to) return;
        event.preventDefault();
        window.open(to, '_blank', 'noopener');
      }}
    >
      {children}
    </tr>
  );
}
