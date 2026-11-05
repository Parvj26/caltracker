import type { InviteResultStatus } from '@caltracker/shared';
import type { ChipTone } from '@/components/ui';

const COPY: Record<InviteResultStatus, string> = {
  sent: 'Invite sent',
  resent: 'Invite re-sent',
  already_member: 'Already your client',
  with_another_coach: "This person already trains with another coach on CalTracker. They'll need to leave that coach first.",
  is_coach: 'This email belongs to a coach account',
  error: "Couldn't send — try Resend",
};

/** Chip colour for a send result. The words always carry the meaning; colour only supports them. */
const TONE: Record<InviteResultStatus, ChipTone> = {
  sent: 'lime',
  resent: 'lime',
  already_member: 'grey',
  with_another_coach: 'pink',
  is_coach: 'grey',
  error: 'amber',
};

export function statusCopy(status: InviteResultStatus, message?: string): string {
  return message ?? COPY[status];
}

export type StatusView = { text: string; tone: ChipTone };

export function statusView(status: InviteResultStatus, message?: string): StatusView {
  return { text: statusCopy(status, message), tone: TONE[status] };
}
