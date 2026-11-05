'use client';

import { useEffect, useState } from 'react';
import { Chip } from '@/components/ui';
import styles from './save-status.module.css';

/** How long the "✓ Saved" chip shows before it settles to "All changes saved". */
export const SAVED_CHIP_MS = 4000;

/**
 * The save state, shown right beside a Save button and announced politely: "Unsaved changes" (amber), "✓ Saved"
 * (lime) for about 4 s after a save, then a quiet "All changes saved". While saving the button itself reads
 * "Saving…", so this only says it for screen readers. Errors are shown by the caller next to the button.
 */
export function SaveStatus({
  pending,
  dirty,
  everSaved,
  savedAt,
}: {
  pending: boolean;
  dirty: boolean;
  everSaved: boolean;
  /** Date.now() of the last successful save, or null. */
  savedAt: number | null;
}) {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (savedAt === null) return;
    const timer = setTimeout(() => setExpired(savedAt), Math.max(0, SAVED_CHIP_MS - (Date.now() - savedAt)));
    return () => clearTimeout(timer);
  }, [savedAt]);
  const fresh = savedAt !== null && expired !== savedAt;

  return (
    <p role="status" className={styles.status}>
      {pending ? (
        <span className={styles.visuallyHidden}>Saving…</span>
      ) : dirty ? (
        <Chip tone="amber">Unsaved changes</Chip>
      ) : fresh ? (
        <Chip tone="lime">
          <span aria-hidden="true">✓</span> Saved
        </Chip>
      ) : everSaved ? (
        <span className={styles.quiet}>All changes saved</span>
      ) : null}
    </p>
  );
}
