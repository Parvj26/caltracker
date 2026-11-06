'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { NAV_ICONS, type NavIconName } from './nav-icons';
import styles from './coach.module.css';

/** A sidebar item (an icon, or `leading` such as the coach's photo, with an optional unread badge). It is the current page when the path is its href or below it (e.g. /exercises/123). */
export function NavLink({
  href,
  label,
  icon,
  leading,
  badge = 0,
}: {
  href: string;
  label: string;
  icon?: NavIconName;
  leading?: ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
      aria-current={current ? 'page' : undefined}
      className={cx(styles.navItem, current && styles.navItemCurrent)}
    >
      {leading ?? (icon ? NAV_ICONS[icon] : null)}
      <span className={styles.navLabel}>{label}</span>
      {badge > 0 ? (
        <span className={styles.navBadge} data-nav-badge="" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
