'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../clients/confirm-button';
import type { CommunityOutcome } from './actions';

type Ask = {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<CommunityOutcome>;
  /** Focused after it is done (what was removed is gone, and focus with it). */
  focusAfterId: string;
};

/**
 * "Are you sure?" in the app's own dialog (the one Remove client uses), instead of the browser's confirm box.
 * `ask` opens it; `dialog` goes anywhere in the caller's markup. It stays open with the error if the action fails.
 */
export function useConfirm(): { ask: (a: Ask) => void; dialog: ReactNode } {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [asking, setAsking] = useState<{ ask: Ask; n: number } | null>(null);
  useEffect(() => {
    if (!asking) return;
    resetRef.current?.();
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, [asking]);
  return {
    ask: (a) => setAsking((prev) => ({ ask: a, n: (prev?.n ?? 0) + 1 })),
    dialog: asking ? <ConfirmDialog {...asking.ask} dialogRef={dialogRef} resetRef={resetRef} /> : null,
  };
}
