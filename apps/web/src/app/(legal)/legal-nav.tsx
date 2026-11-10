'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './legal.module.css';

/** The header links: the other legal page, then Sign in (the Privacy board shows "Terms · Sign in"). */
export function LegalNav() {
  const other = usePathname() === '/terms' ? { href: '/privacy', label: 'Privacy' } : { href: '/terms', label: 'Terms' };
  return (
    <nav aria-label="Legal" className={styles.nav}>
      <Link href={other.href}>{other.label}</Link>
      <Link href="/sign-in">Sign in</Link>
    </nav>
  );
}
