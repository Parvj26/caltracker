'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useId, useRef, useState, useTransition, type ReactNode } from 'react';
import { AdaptiveDialog, Button, ErrorText, type AdaptiveDialogHandle } from '@/components/ui';
import type { CommunityOutcome } from './actions';

type Ask = {
  /** Unique per item, for the address while it is open (?sheet=…), so Back closes it. */
  historyId: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<CommunityOutcome>;
};

/** One "Are you sure?" pop-up. Stays open with the error if the action fails. */
function ConfirmPopup({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const bodyId = useId();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await ask.onConfirm();
      if (r.ok) await ref.current?.close();
      else setError(r.code);
    });
  };
  return (
    <AdaptiveDialog
      ref={ref}
      historyId={ask.historyId}
      role="alertdialog"
      describedBy={bodyId}
      title={ask.title}
      onClose={onClose}
      busy={pending}
      stackFooterOnPhone
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} pending={pending} phSafe>
            {pending ? 'Working…' : ask.confirmLabel}
          </Button>
        </>
      }
    >
      <p id={bodyId}>{ask.body}</p>
      {error ? <ErrorText code={error} /> : null}
    </AdaptiveDialog>
  );
}

/**
 * "Are you sure?" in the app's own pop-up (AdaptiveDialog: a sheet on a phone, a centred dialog on iPad and desktop,
 * closed by Back), instead of the browser's confirm box. `ask` opens it; `dialog` goes anywhere in the caller's markup.
 */
export function useConfirm(): { ask: (a: Ask) => void; dialog: ReactNode } {
  const [asking, setAsking] = useState<Ask | null>(null);
  return {
    ask: setAsking,
    dialog: asking ? <ConfirmPopup key={asking.historyId} ask={asking} onClose={() => setAsking(null)} /> : null,
  };
}
