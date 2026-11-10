'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AdminRole } from '@/lib/roles';
import styles from './admin-shell.module.css';

const LINKS = [
  { href: '/overview', label: 'Overview' },
  { href: '/coaches', label: 'Coaches' },
  { href: '/clients', label: 'Clients' },
  { href: '/logs', label: 'Logs' },
  { href: '/audit', label: 'Audit log' },
] as const;

/** Side menu (stacks above the page at phone width) and the page area. Admins is in the menu for owners only. */
export function AdminShell({ name, role, staging, children }: { name: string; role: AdminRole; staging: boolean; children: ReactNode }) {
  const path = usePathname();
  const links = role === 'owner' ? [...LINKS, { href: '/admins', label: 'Admins' }] : LINKS;
  return (
    <div className={styles.shell}>
      <nav aria-label="Admin" className={styles.nav}>
        <span className={styles.brand}>
          CalTracker
          {staging ? <span className={styles.staging}>STAGING</span> : null}
        </span>
        <span className={styles.role}>ADMIN · {role.toUpperCase()}</span>
        <div className={styles.links}>
          {links.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={active ? `${styles.link} ${styles.active}` : styles.link}>
                {l.label}
              </Link>
            );
          })}
        </div>
        <span className={styles.spacer} />
        <span className={styles.who}>Signed in as {name} · 2-step on</span>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className={styles.signOut}>Sign out</button>
        </form>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
