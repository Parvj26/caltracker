// Feed ordering, visibility and who may do what. The database decides (RLS); these only shape the screens, e.g. to
// hide a blocked member at once, before the feed reloads, and to show only the buttons that will work.

export type Viewer = { userId: string; isCoach: boolean };

export type FeedPostLike = { id: string; authorId: string; createdAt: string; pinnedAt: string | null };

/** Pinned posts first (most recently pinned on top), then newest first. Ties break on id so the order is stable. */
export function sortFeed<T extends FeedPostLike>(posts: readonly T[]): T[] {
  return [...posts].sort((a, b) => {
    if ((a.pinnedAt === null) !== (b.pinnedAt === null)) return a.pinnedAt === null ? 1 : -1;
    if (a.pinnedAt !== null && b.pinnedAt !== null && a.pinnedAt !== b.pinnedAt) return a.pinnedAt < b.pinnedAt ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** Drops anything written by someone the viewer blocked. */
export function withoutBlocked<T extends { authorId: string }>(items: readonly T[], blocked: ReadonlySet<string>): T[] {
  return items.filter((i) => !blocked.has(i.authorId));
}

/** Your own post or comment, or anything when you are the coach. */
export const canDelete = (viewer: Viewer, authorId: string): boolean => viewer.isCoach || viewer.userId === authorId;

export const canPin = (viewer: Viewer): boolean => viewer.isCoach;

/** Anyone can report someone else's post or comment (reports go to the coach). */
export const canReport = (viewer: Viewer, authorId: string): boolean => viewer.userId !== authorId;

/** Clients can block other clients; the coach (the moderator) is never blocked and never blocks. */
export const canBlock = (viewer: Viewer, author: { id: string; isCoach: boolean }): boolean =>
  !viewer.isCoach && !author.isCoach && author.id !== viewer.userId;

/** "Former member" when a name no longer resolves (someone who left the business). */
export function memberName(name: { firstName: string | null; lastName: string | null } | null | undefined): string {
  const full = [name?.firstName, name?.lastName].filter((p) => p && p.trim()).join(' ').trim();
  return full || 'Former member';
}

/** One-or-two letter initials for an avatar without a photo. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** "Just now", "5m", "3h", "2d", then a date ("Nov 3", or "Nov 3, 2025" in another year). */
export function postAge(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
