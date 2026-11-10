import type { ReactNode } from 'react';
import { Card } from './card';
import { Logo } from './logo';
import styles from './ui.module.css';

/** Page frame for sign-in, two-step and "Not authorised": the logo, then one card. */
export function AuthShell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.authShell}>
      <section className={styles.authPanel}>
        <Logo size="lg" />
        <p className={styles.authTagline}>Admin</p>
      </section>
      <main className={styles.authMain}>
        <Card className={styles.authCard}>
          <h1 className={styles.screenTitle}>{title}</h1>
          {children}
        </Card>
      </main>
    </div>
  );
}
