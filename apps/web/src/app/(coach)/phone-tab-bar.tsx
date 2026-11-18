'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { NAV_ICONS, type NavIconName } from './nav-icons';
import { currentTab, type TabId } from './tab-bar-model';
import styles from './coach.module.css';

type PageTab = { id: Exclude<TabId, 'library' | 'more'>; href: string; label: string; icon: NavIconName };
const BEFORE_LIBRARY: PageTab[] = [
  { id: 'home', href: '/home', label: 'Home', icon: 'home' },
  { id: 'clients', href: '/clients', label: 'Clients', icon: 'clients' },
];
const AFTER_LIBRARY: PageTab[] = [{ id: 'messages', href: '/messages', label: 'Messages', icon: 'messages' }];

/**
 * The iPhone tab bar (below 600 px; CSS hides it on iPad and desktop): Home, Clients, Library (a sheet of Workouts,
 * Exercise library and Programs), Messages and More (the rest of the menu as a sheet). While a sheet is open its tab is
 * the highlighted one; otherwise the tab for the page you're on.
 * Screens with their own bottom controls (data-no-menu-button) hide it.
 */
export function PhoneTabBar({
  ref,
  libraryRef,
  unread,
  moreOpen,
  onMore,
  libraryOpen,
  onLibrary,
}: {
  ref: Ref<HTMLButtonElement>;
  libraryRef: Ref<HTMLButtonElement>;
  unread: number;
  moreOpen: boolean;
  onMore: () => void;
  libraryOpen: boolean;
  onLibrary: () => void;
}) {
  const pathname = usePathname();
  const here = currentTab(pathname);
  const lit = moreOpen ? 'more' : libraryOpen ? 'library' : here;
  const pageTabs = (tabs: PageTab[]) =>
    tabs.map((t) => {
        const badge = t.id === 'messages' ? unread : 0;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={cx(styles.tab, lit === t.id && styles.tabOn)}
            aria-current={here === t.id ? 'page' : undefined}
            aria-label={badge > 0 ? `${t.label}, ${badge} unread` : t.label}
            data-ph-capture-attribute-label={`tab_${t.id}`}
          >
            <span className={styles.tabIcon}>{NAV_ICONS[t.icon]}</span>
            <span data-ph-safe="">{t.label}</span>
            {badge > 0 ? (
              <span className={styles.tabBadge} data-tab-badge="" aria-hidden="true">
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </Link>
        );
      });
  return (
    // data-overlay-edge: calendar ⋯ menus keep clear of it (menu-placement.ts).
    <nav aria-label="Tabs" className={styles.tabBar} data-tab-bar="" data-overlay-edge="bottom">
      {pageTabs(BEFORE_LIBRARY)}
      <button
        ref={libraryRef}
        type="button"
        className={cx(styles.tab, lit === 'library' && styles.tabOn)}
        aria-expanded={libraryOpen}
        aria-haspopup="dialog"
        aria-current={here === 'library' ? 'true' : undefined}
        data-ph-capture-attribute-label="tab_library"
        onClick={onLibrary}
      >
        <span className={styles.tabIcon}>{NAV_ICONS.workouts}</span>
        <span data-ph-safe="">Library</span>
      </button>
      {pageTabs(AFTER_LIBRARY)}
      <button
        ref={ref}
        type="button"
        className={cx(styles.tab, lit === 'more' && styles.tabOn)}
        aria-expanded={moreOpen}
        aria-controls="coach-menu"
        aria-haspopup="dialog"
        data-ph-capture-attribute-label="tab_more"
        onClick={onMore}
      >
        <span className={styles.tabIcon}>{NAV_ICONS.more}</span>
        <span data-ph-safe="">More</span>
      </button>
    </nav>
  );
}
