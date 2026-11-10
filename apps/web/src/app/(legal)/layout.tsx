import Link from 'next/link';
import { LegalNav } from './legal-nav';
import styles from './legal.module.css';

/** The public legal pages (no session needed: proxy.ts leaves /privacy and /terms out of its matcher). */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/sign-in" className={styles.brand}>
          CalTracker
        </Link>
        <LegalNav />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
