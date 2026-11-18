'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, ErrorText } from '@/components/ui';
import styles from './row-toast.module.css';

/**
 * A list row's ⋯ action as it runs (Duplicating…) or fails, shown as a toast at the bottom of the screen (rulebook
 * §11) instead of inside the row's fixed-width action area. The error stays until Dismiss or the next try.
 */
export function RowActionToast({ pending, error, pendingText }: { pending: boolean; error: ErrorCode | null; pendingText: string }) {
  const [dismissed, setDismissed] = useState<ErrorCode | null>(null);
  const [lastError, setLastError] = useState<ErrorCode | null>(error);
  if (lastError !== error) {
    setLastError(error);
    setDismissed(null);
  }
  const showError = error !== null && dismissed !== error;
  if (!pending && !showError) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className={styles.region}>
      {pending ? (
        <div role="status" className={styles.toast}>
          {pendingText}
        </div>
      ) : error ? (
        <div className={styles.toast}>
          <ErrorText code={error} className={styles.error} />
          <Button variant="secondary" size="compact" onClick={() => setDismissed(error)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
