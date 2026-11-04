import type { InviteResultStatus } from '@caltracker/shared';

const COPY: Record<InviteResultStatus, string> = {
  sent: 'Invite sent',
  resent: 'Invite re-sent',
  already_member: 'Already your client',
  with_another_coach: "This person already trains with another coach on CalTracker. They'll need to leave that coach first.",
  is_coach: 'This email belongs to a coach account',
  error: "Couldn't send — try Resend",
};

export function statusCopy(status: InviteResultStatus, message?: string): string {
  return message ?? COPY[status];
}
