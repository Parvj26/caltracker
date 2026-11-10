import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/ui';
import styles from '../auth.module.css';

export const metadata: Metadata = { title: 'Not authorised' };

/** Reached only after signing out (/auth/denied, or the sign-in action for a non-admin). */
export default function NotAuthorisedPage() {
  return (
    <AuthShell title="Not authorised">
      <p className={styles.lead}>This site is for CalTracker staff. You have been signed out.</p>
      <Link href="/sign-in">Sign in with another account</Link>
    </AuthShell>
  );
}
