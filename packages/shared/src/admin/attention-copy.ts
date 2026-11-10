/** The "Needs attention" kinds returned by `admin_needs_attention()`, in the plan's order. */
export const ATTENTION_KINDS = [
  'invite_expired',
  'no_signin_7d',
  'notifications_off',
  'push_failed',
  'coach_inactive_14d',
  'coach_no_meals',
] as const;

export type AttentionKind = (typeof ATTENTION_KINDS)[number];

const COPY: Record<AttentionKind, { problem: string; actionLabel: string }> = {
  invite_expired: { problem: 'Invite expired', actionLabel: 'Resend invite' },
  no_signin_7d: { problem: 'Not signed in for 7 days', actionLabel: 'Open' },
  notifications_off: { problem: 'Notifications off', actionLabel: 'Open' },
  push_failed: { problem: 'Notification failed', actionLabel: 'Open' },
  coach_inactive_14d: { problem: 'No activity for 14 days', actionLabel: 'Open' },
  coach_no_meals: { problem: 'No meals shared', actionLabel: 'Open' },
};

/** The problem tag and row button text for a "Needs attention" row (copy from the mockups). */
export function attentionCopy(kind: AttentionKind): { problem: string; actionLabel: string } {
  return COPY[kind];
}
