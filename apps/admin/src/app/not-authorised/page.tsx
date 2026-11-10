import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/ui';
import styles from '../auth.module.css';

export const metadata: Metadata = { title: 'Not authorised' };

/**
 * Two ways here: a signed-in admin whose role can't open a page (?reason=role, still signed in), or someone who isn't
 * an admin at all (already signed out by /auth/denied or the sign-in action).
 */
export default async function NotAuthorisedPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  if (reason === 'role') {
    return (
      <AuthShell title="Not authorised">
        <p className={styles.lead}>Your admin role can&apos;t open that page. Ask an owner if you need it.</p>
        <Link href="/overview">Back to Overview</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Not authorised">
      <p className={styles.lead}>This site is for CalTracker staff. You have been signed out.</p>
      <Link href="/sign-in">Sign in with another account</Link>
    </AuthShell>
  );
}
