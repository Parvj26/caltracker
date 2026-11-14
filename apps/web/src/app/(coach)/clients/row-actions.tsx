'use client';

import { cancelInvite, removeClient } from './actions';
import type { RefObject } from 'react';
import { ConfirmButton, ConfirmDialog } from './confirm-button';

const REMOVE_BODY =
  "They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back.";

export function RemoveClientButton({ userId, name, focusAfterId = 'clients-heading' }: { userId: string; name: string; focusAfterId?: string }) {
  const who = name || 'this client';
  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Remove ${who}`}
      title={`Remove ${who}?`}
      body={REMOVE_BODY}
      confirmLabel="Remove"
      onConfirm={() => removeClient(userId)}
      focusAfterId={focusAfterId}
    />
  );
}

/** The same "Remove …?" question, opened from elsewhere (the client page's ⋯ menu) with `dialogRef.current.showModal()`. */
export function RemoveClientDialog({ userId, name, focusAfterId, dialogRef }: { userId: string; name: string; focusAfterId: string; dialogRef: RefObject<HTMLDialogElement | null> }) {
  const who = name || 'this client';
  return (
    <ConfirmDialog
      title={`Remove ${who}?`}
      body={REMOVE_BODY}
      confirmLabel="Remove"
      onConfirm={() => removeClient(userId)}
      focusAfterId={focusAfterId}
      dialogRef={dialogRef}
    />
  );
}

export function CancelInviteButton({ inviteId, email, inline = false }: { inviteId: string; email: string; inline?: boolean }) {
  return (
    <ConfirmButton
      inline={inline}
      label={inline ? 'Cancel' : 'Cancel invite'}
      ariaLabel={`Cancel invite to ${email}`}
      title="Cancel this invite?"
      body={`Cancel the invite to ${email}? The link in their email will stop working.`}
      confirmLabel="Cancel invite"
      onConfirm={() => cancelInvite(inviteId)}
      focusAfterId="clients-heading"
    />
  );
}
