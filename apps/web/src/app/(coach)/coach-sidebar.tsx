'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { trapTabTarget } from './focus-trap';
import { UnreadTotalContext, useUnreadTotal } from './messages-nav-link';
import { NAV_ICONS } from './nav-icons';
import styles from './coach.module.css';

/** Matches the CSS phone breakpoint (below the 600 px tablet breakpoint in the design tokens). */
const PHONE_QUERY = '(max-width: 599.98px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The coach menu. On iPad and desktop it is the side menu (a full sidebar, or an icon rail below 1200 px). On an iPhone
 * it hides behind a floating menu button and opens as a bottom sheet of big tiles: the same items, restyled by CSS.
 * It also owns the unread message total, so the Inbox badge and the button's red dot always agree.
 */
export function CoachSidebar({
  userId,
  workspaceId,
  initialUnread,
  children,
}: {
  userId: string;
  workspaceId: string;
  initialUnread: number;
  children: ReactNode;
}) {
  const unread = useUnreadTotal(userId, workspaceId, initialUnread);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  // On an iPhone the floating button tucks away while the coach scrolls down (reading or filling in a page) and comes
  // back as soon as they scroll up, or reach the top or bottom of the page.
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia(PHONE_QUERY);
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const atEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 4;
        if (!phone.matches || y < 24 || atEnd) setTucked(false);
        else if (y > last + 6) setTucked(true);
        else if (y < last - 6) setTucked(false);
        last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const items = () => Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const list = items();
        const target = trapTabTarget(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (target !== null) {
          e.preventDefault();
          list[target]?.focus();
        }
      }
    };
    // Back on a wider screen (rotation, split view) the side menu returns, so the sheet closes.
    const phone = window.matchMedia(PHONE_QUERY);
    const onResize = () => {
      if (!phone.matches) setOpen(false);
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    phone.addEventListener('change', onResize);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      phone.removeEventListener('change', onResize);
    };
  }, [open, close]);

  // A tile (a page, Help & feedback or Sign out) closes the sheet.
  const onSheetClick = (e: React.MouseEvent) => {
    if (open && (e.target as Element).closest('a, button')) close();
  };

  return (
    <UnreadTotalContext.Provider value={unread}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="coach-menu"
        data-ph-capture-attribute-label="phone_menu"
        data-tucked={tucked && !open ? '' : undefined}
        onClick={() => setOpen(true)}
      >
        {NAV_ICONS.menu}
        {unread > 0 ? <span className={styles.menuDot} data-menu-dot="" aria-hidden="true" /> : null}
      </button>
      {open ? <div className={styles.backdrop} data-menu-backdrop="" aria-hidden="true" onClick={close} /> : null}
      <aside
        ref={sheetRef}
        id="coach-menu"
        className={cx(styles.sidebar, open && styles.sidebarOpen)}
        data-coach-sidebar=""
        {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menu' } : {})}
        onClick={onSheetClick}
      >
        <span className={styles.grabHandle} aria-hidden="true" />
        {children}
      </aside>
    </UnreadTotalContext.Provider>
  );
}
