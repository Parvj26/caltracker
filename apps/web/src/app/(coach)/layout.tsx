import Link from 'next/link';
import { requireCoach } from '@/lib/auth';
import styles from './coach.module.css';

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const coach = await requireCoach();
  return (
    <div>
      <header className={styles.header}>
        <strong>{coach.workspaceName}</strong>
        <nav className={styles.nav}>
          <Link href="/clients">Clients</Link>
          <Link href="/exercises">Exercises</Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
