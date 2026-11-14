'use client';

import { useId, useState } from 'react';
import { injurySummary } from '@/lib/injury-summary';
import styles from './client-page.module.css';

/**
 * An amber chip with the first line of the coach's "Limitations & injuries" note ("Left knee: no deep squats",
 * "+2 more" when there are more lines). A tap shows the whole note under it, so it can be read without leaving the
 * page (also mid-session on the logger). Nothing when no note is kept.
 */
export function InjuryChip({ text }: { text: string }) {
  const summary = injurySummary(text);
  const [open, setOpen] = useState(false);
  const noteId = useId();
  if (!summary) return null;
  return (
    <div className={styles.injury} data-testid="injury-chip">
      <button type="button" className={styles.injuryChip} aria-expanded={open} aria-controls={noteId} onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className={styles.injuryIcon}>
          <path d="M12 3l10 18H2z" fill="var(--ct-amber)" stroke="var(--ct-ink)" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M12 10v5M12 18v.5" stroke="var(--ct-ink)" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <span className={styles.injuryText}>
          <span className={styles.visuallyHidden}>Injury: </span>
          {summary.first}
        </span>
        {summary.more > 0 ? <span className={styles.injuryMore}>+{summary.more} more</span> : null}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.injuryChevron}>
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <p id={noteId} className={styles.injuryNote} hidden={!open}>
        {text.trim()}
      </p>
    </div>
  );
}
