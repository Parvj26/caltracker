'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { NAV_ICONS, type NavIconName } from './nav-icons';
import styles from './coach.module.css';

/** A sidebar item (with an optional unread badge). It is the current page when the path is its href or below it (e.g. /exercises/123). */
export function NavLink({ href, label, icon, badge = 0 }: { href: string; label: string; icon: NavIconName; badge?: number }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
      aria-current={current ? 'page' : undefined}
      className={cx(styles.navItem, current && styles.navItemCurrent)}
    >
      {NAV_ICONS[icon]}
      <span className={styles.navLabel}>{label}</span>
      {badge > 0 ? (
        <span className={styles.navBadge} data-nav-badge="" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
