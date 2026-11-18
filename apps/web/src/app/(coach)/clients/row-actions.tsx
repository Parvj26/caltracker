'use client';

import { cancelInvite, removeClient } from './actions';
import type { Ref } from 'react';
import { ConfirmButton, ConfirmDialog, type ConfirmHandle } from './confirm-button';

const REMOVE_BODY =
  "They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back.";

/** Settings page: "Remove client…" (red outline), asking first. */
export function RemoveClientButton({ userId, name, focusAfterId = 'clients-heading' }: { userId: string; name: string; focusAfterId?: string }) {
  const who = name || 'this client';
  return (
    <ConfirmButton
      label="Remove client…"
      ariaLabel="Remove client…"
      title={`Remove ${who}?`}
      body={REMOVE_BODY}
      confirmLabel="Remove client"
      onConfirm={() => removeClient(userId)}
      focusAfterId={focusAfterId}
      historyId={`remove-${userId}`}
    />
  );
}

/** The same "Remove …?" question, mounted while asked (the client page's ⋯ menu). */
export function RemoveClientDialog({ userId, name, focusAfterId, onClose }: { userId: string; name: string; focusAfterId: string; onClose: () => void }) {
  const who = name || 'this client';
  return (
    <ConfirmDialog
      title={`Remove ${who}?`}
      body={REMOVE_BODY}
      confirmLabel="Remove client"
      onConfirm={() => removeClient(userId)}
      focusAfterId={focusAfterId}
      historyId={`remove-${userId}`}
      onClose={onClose}
    />
  );
}

/** "Cancel this invite?" opened through `handle` (the invite row's ⋯ menu). */
export function CancelInviteButton({ inviteId, email, handle }: { inviteId: string; email: string; handle?: Ref<ConfirmHandle> }) {
  return (
    <ConfirmButton
      handle={handle}
      trigger={false}
      label="Cancel invite…"
      ariaLabel={`Cancel invite… ${email}`}
      title="Cancel this invite?"
      body={`Cancel the invite to ${email}? The link in their email will stop working. You can invite them again later.`}
      confirmLabel="Cancel invite"
      onConfirm={() => cancelInvite(inviteId)}
      focusAfterId="clients-heading"
      historyId={`cancel-invite-${inviteId}`}
    />
  );
}
