'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { NAV_ICONS, type NavIconName } from './nav-icons';
import { currentTab, type TabId } from './tab-bar-model';
import styles from './coach.module.css';

const TABS: { id: Exclude<TabId, 'more'>; href: string; label: string; icon: NavIconName }[] = [
  { id: 'home', href: '/home', label: 'Home', icon: 'home' },
  { id: 'clients', href: '/clients', label: 'Clients', icon: 'clients' },
  { id: 'messages', href: '/messages', label: 'Messages', icon: 'messages' },
  { id: 'programs', href: '/programs', label: 'Programs', icon: 'programs' },
];

/**
 * The iPhone tab bar (below 600 px; CSS hides it on iPad and desktop): four pages and More, which opens the rest of
 * the menu as a sheet. While the sheet is open More is the highlighted tab; otherwise the tab for the page you're on.
 * Screens with their own bottom controls (data-no-menu-button) hide it.
 */
export function PhoneTabBar({
  ref,
  unread,
  moreOpen,
  onMore,
}: {
  ref: Ref<HTMLButtonElement>;
  unread: number;
  moreOpen: boolean;
  onMore: () => void;
}) {
  const pathname = usePathname();
  const here = currentTab(pathname);
  const lit = moreOpen ? 'more' : here;
  return (
    // data-overlay-edge: calendar ⋯ menus keep clear of it (menu-placement.ts).
    <nav aria-label="Tabs" className={styles.tabBar} data-tab-bar="" data-overlay-edge="bottom">
      {TABS.map((t) => {
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
      })}
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
