import type { ReactNode } from 'react';
import { Card } from './card';
import { HandNote } from './hand-note';
import { Logo } from './logo';
import { Tile } from './tile';
import styles from './ui.module.css';

const TAGLINE_LINES = ['Build programs.', 'Log sessions.', 'Celebrate every PR.'] as const;
export const AUTH_TAGLINE = TAGLINE_LINES.join(' ');

/** Branded page frame for sign-in and other signed-out screens. */
export function AuthShell({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.authShell}>
      <section className={styles.authPanel}>
        <Logo size="lg" />
        <p className={styles.authTagline}>
          {TAGLINE_LINES.map((line, i) => (
            <span key={line}>{i > 0 ? ' ' : ''}{line}</span>
          ))}
        </p>
        {/* A taste of the dashboard. Decorative only. */}
        <div className={styles.authPreview} aria-hidden="true">
          <Tile tone="pink" label="New PRs this week" value="🎉 7" className={styles.authPreviewA} />
          <div className={styles.authPreviewB}>
            <p className={styles.tileLabel}>Done this week</p>
            <p className={styles.tileValue}>86%</p>
            <span className={styles.authBar}><i /></span>
          </div>
          <Tile tone="blue" label="Workouts today" value="14" className={styles.authPreviewC} />
        </div>
      </section>
      <main className={styles.authMain}>
        <Card className={styles.authCard}>
          <div className={styles.authHeading}>
            <h1 className={styles.screenTitle}>{title}</h1>
            {note ? <HandNote>{note}</HandNote> : null}
          </div>
          {children}
        </Card>
      </main>
    </div>
  );
}
