/**
 * Sort order for pending invites (product owner decision): newest first by when the invite was created, so the
 * client a coach just added is at the top. A resend does not move it (that changes sent_at, not created_at).
 * Joined clients are sorted by last name instead.
 */
export function newestInviteFirst(a: { created_at: string | null }, b: { created_at: string | null }): number {
  const time = (i: { created_at: string | null }) => (i.created_at ? new Date(i.created_at).getTime() : -Infinity);
  const diff = time(b) - time(a);
  return Number.isNaN(diff) ? 0 : diff;
}
