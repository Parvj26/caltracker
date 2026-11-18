'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { pruneDrafts } from '@/lib/session-draft';
import { startTabPresence } from '@/lib/tab-id';
import { cycleTabTarget } from './focus-trap';
import { LAST_PAGE_KEY } from './help/support-page';
import { LibrarySheet } from './library-menu';
import { useBackLayer } from '@/lib/open-layer';
import { UnreadTotalContext, useUnreadTotal } from './messages-nav-link';
import { PhoneTabBar } from './phone-tab-bar';
import styles from './coach.module.css';

/** Matches the CSS phone breakpoint (below the 600 px tablet breakpoint in the design tokens). */
const PHONE_QUERY = '(max-width: 599.98px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The coach menu. On iPad and desktop it is the side menu (a full sidebar, or an icon rail below 1200 px). On an iPhone
 * a tab bar sits at the bottom (Home, Clients, Library, Messages, More): Library opens a sheet of Workouts, Exercise
 * library and Programs, and More opens the rest of the menu as a bottom sheet of big tiles: the sidebar itself,
 * restyled by CSS. It also owns the unread message total, so the
 * sidebar's Messages badge and the tab bar's agree.
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
  const moreRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryRef = useRef<HTMLButtonElement>(null);
  const closeLibrary = useCallback((refocus: boolean) => {
    setLibraryOpen(false);
    if (refocus) libraryRef.current?.focus();
  }, []);

  // Copies of live sessions kept on this device: drop other coaches', broken and old ones once per load.
  useEffect(() => {
    pruneDrafts(userId);
  }, [userId]);
  // This tab answers the others (which tabs are open) and gets a fresh id if it is a duplicated tab.
  useEffect(() => startTabPresence(), []);

  // Help names the page the coach was on before it in a support email, so remember it (path only, this tab only).
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === '/help') return;
    try {
      sessionStorage.setItem(LAST_PAGE_KEY, pathname);
    } catch {
      // Storage blocked (private mode): the email names the Help page instead.
    }
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    moreRef.current?.focus();
  }, []);
  // Back (and iOS swipe-back) closes the More sheet, not the page.
  useBackLayer(open, close);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    // Only what is shown: the tab bar's own pages are in the sidebar too, hidden from the sheet.
    const tiles = () => Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.getClientRects().length > 0);
    tiles()[0]?.focus();
    // Tab goes round the tiles and the More button (which closes the sheet), nothing behind them.
    const items = () => [...tiles(), ...(moreRef.current ? [moreRef.current] : [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        const list = items();
        const target = cycleTabTarget(list.length, list.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        // Always handled here: the More button sits before the sheet in the page, so the browser's own order would leave.
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

  // A tile (a page, Help or Profile) closes the sheet.
  const onSheetClick = (e: React.MouseEvent) => {
    if (open && (e.target as Element).closest('a, button')) close();
  };

  return (
    <UnreadTotalContext.Provider value={unread}>
      <PhoneTabBar
        ref={moreRef}
        libraryRef={libraryRef}
        unread={unread}
        moreOpen={open}
        onMore={() => (open ? close() : setOpen(true))}
        libraryOpen={libraryOpen}
        onLibrary={() => {
          setOpen(false);
          setLibraryOpen((o) => !o);
        }}
      />
      <LibrarySheet open={libraryOpen} close={closeLibrary} trigger={libraryRef} />
      {open ? <div className={styles.backdrop} data-menu-backdrop="" aria-hidden="true" onClick={close} /> : null}
      <aside
        ref={sheetRef}
        id="coach-menu"
        className={cx(styles.sidebar, open && styles.sidebarOpen)}
        data-coach-sidebar=""
        {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'More' } : {})}
        onClick={onSheetClick}
      >
        <span className={styles.grabHandle} aria-hidden="true" />
        {/* Screen readers treat everything outside a modal sheet as hidden, so it needs its own way out. */}
        {open ? (
          <button type="button" className={styles.srClose} onClick={close}>
            Close menu
          </button>
        ) : null}
        {children}
      </aside>
    </UnreadTotalContext.Provider>
  );
}
