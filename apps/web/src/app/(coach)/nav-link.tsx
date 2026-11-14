'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui/cx';
import { NAV_ICONS, type NavIconName } from './nav-icons';
import styles from './coach.module.css';

/**
 * A sidebar item (an icon, or `leading` such as the coach's photo, with an optional unread badge). It is the current
 * page when the path is its href or below it (e.g. /exercises/123). `label` must be fixed menu copy: it is shown in
 * session recordings (the badge count is not).
 */
export function NavLink({
  href,
  label,
  icon,
  leading,
  badge = 0,
  className,
}: {
  href: string;
  label: string;
  icon?: NavIconName;
  leading?: ReactNode;
  badge?: number;
  /** Extra class, e.g. hiding a page from the phone's More sheet when the tab bar already has it. */
  className?: string | undefined;
}) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      data-ph-capture-attribute-label={`nav_${href.replace(/^\//, '').replace(/\W+/g, '_')}`}
      aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
      title={label}
      aria-current={current ? 'page' : undefined}
      className={cx(styles.navItem, current && styles.navItemCurrent, className)}
    >
      {leading ?? (icon ? NAV_ICONS[icon] : null)}
      <span className={styles.navLabel} data-ph-safe="">
        {label}
      </span>
      {badge > 0 ? (
        <span className={styles.navBadge} data-nav-badge="" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}
