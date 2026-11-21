'use client';

import { useId, useState } from 'react';
import { flagChipSummary, flagHeadline, formatPlainDayMonth, openFlagsNewestFirst, type ClientFlag } from '@caltracker/shared';
import styles from './client-page.module.css';

/**
 * An amber chip with the client's newest open flag ("Neck pain", "+1 more" when more are open). A tap lists every open
 * flag under it with its note, so it can be read without leaving the page (also mid-session on the logger and in
 * Training now). Nothing when no flag is open.
 */
export function InjuryChip({ flags }: { flags: readonly ClientFlag[] }) {
  const summary = flagChipSummary(flags);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!summary) return null;
  const openFlags = openFlagsNewestFirst(flags);
  return (
    <div className={styles.injury} data-testid="injury-chip">
      <button type="button" className={styles.injuryChip} aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
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
      <ul id={listId} className={styles.injuryNote} hidden={!open}>
        {openFlags.map((f) => (
          <li key={f.id}>
            <strong>{flagHeadline(f)}</strong> · since {formatPlainDayMonth(f.since)}
            {/* A pain's or injury's note follows; a limitation's first line is already its headline, so only a longer one shows in full. */}
            {f.type !== 'limitation' && f.region !== null && f.note.trim() ? <> · “{f.note.trim()}”</> : null}
            {(f.type === 'limitation' || f.region === null) && f.note.trim().includes('\n') ? <span className={styles.injuryFull}>{f.note.trim()}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
