'use client';

import { cancelInvite, removeClient } from './actions';
import { ConfirmButton } from './confirm-button';

export function RemoveClientButton({ userId, name }: { userId: string; name: string }) {
  const who = name || 'this client';
  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Remove ${who}`}
      title={`Remove ${who}?`}
      body="They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back."
      confirmLabel="Remove"
      onConfirm={() => removeClient(userId)}
      focusAfterId="clients-heading"
    />
  );
}

export function CancelInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  return (
    <ConfirmButton
      label="Cancel invite"
      ariaLabel={`Cancel invite to ${email}`}
      title="Cancel this invite?"
      body={`Cancel the invite to ${email}? The link in their email will stop working.`}
      confirmLabel="Cancel invite"
      onConfirm={() => cancelInvite(inviteId)}
      focusAfterId="pending-heading"
    />
  );
}
