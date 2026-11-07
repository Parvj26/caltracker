'use client';

import { cancelInvite, removeClient } from './actions';
import { ConfirmButton } from './confirm-button';

export function RemoveClientButton({ userId, name, focusAfterId = 'clients-heading' }: { userId: string; name: string; focusAfterId?: string }) {
  const who = name || 'this client';
  return (
    <ConfirmButton
      label="Remove"
      ariaLabel={`Remove ${who}`}
      title={`Remove ${who}?`}
      body="They'll lose access to your workouts, messages and community. Their history stays under Past clients, and re-inviting them brings everything back."
      confirmLabel="Remove"
      onConfirm={() => removeClient(userId)}
      focusAfterId={focusAfterId}
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
