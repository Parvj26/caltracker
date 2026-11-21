'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { flagReminderText, formatPlainDayMonth, type ClientFlag } from '@caltracker/shared';
import { openFlagsFor } from '@/app/(coach)/clients/[clientId]/flags-actions';
import styles from './flags.module.css';

/** Where the reminder bar opens: the client's Limitations & injuries tab (board AS10). */
export const flagsHref = (clientId: string) => `/clients/${clientId}/limitations`;

/**
 * The builder's slim amber reminder (board AS10): "Vaishali: Neck pain (20 Nov) · Left knee: no deep squats", open
 * flags newest first. Only for a workout built for one client; a tap opens their flags. Nothing when none are open.
 */
export function FlagReminder({ clientId, firstName, flags }: { clientId: string; firstName: string; flags: readonly ClientFlag[] }) {
  const text = flagReminderText(firstName, flags, formatPlainDayMonth);
  if (!text) return null;
  return (
    <Link href={flagsHref(clientId)} className={styles.reminder} data-testid="flag-reminder" aria-label={`${text}. Open ${firstName}’s limitations and injuries`}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className={styles.reminderIcon}>
        <path d="M12 3l10 18H2z" fill="var(--ct-amber)" stroke="var(--ct-ink)" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M12 10v5M12 18v.5" stroke="var(--ct-ink)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <span className={styles.reminderText}>{text}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.reminderChevron}>
        <path d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/** The same reminder, loading the client's name and open flags itself (the "+ New workout" sheet has no server data). */
export function FlagReminderLoader({ clientId }: { clientId: string }) {
  const [loaded, setLoaded] = useState<{ firstName: string; flags: ClientFlag[] } | null>(null);
  useEffect(() => {
    let live = true;
    openFlagsFor(clientId)
      .then((r) => {
        if (live) setLoaded(r);
      })
      // Only a reminder: never break the builder over it.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clientId]);
  return loaded ? <FlagReminder clientId={clientId} firstName={loaded.firstName} flags={loaded.flags} /> : null;
}
