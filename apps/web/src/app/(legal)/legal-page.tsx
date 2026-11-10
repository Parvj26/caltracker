import type { ReactNode } from 'react';
import { SUPPORT_EMAIL } from '@caltracker/shared';
import { DRAFT_UNDER_REVIEW } from './last-updated';
import styles from './legal.module.css';

/** The page title, with "Last updated <date> · Draft: under review" under it. */
export function LegalHeading({ title, updated }: { title: string; updated: string }) {
  return (
    <div className={styles.heading}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.updated}>
        Last updated {updated}
        {DRAFT_UNDER_REVIEW ? ' · Draft: under review' : null}
      </p>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/** The support address as a mailto link. */
export function SupportEmail() {
  return <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
}
