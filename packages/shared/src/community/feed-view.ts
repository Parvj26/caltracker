// What the community feed shows: the filter pills, the comment preview under each post and the small count labels.
// The database decides what may be seen (RLS); these only pick and word it.
import { posterFirstName } from './cards';

export type FeedFilter = 'all' | 'coach' | 'wins';

/** All posts; only the coach's; or "wins": posts carrying a shared workout, PR or sticker card. */
export function filterFeed<T extends { authorId: string; card: unknown }>(posts: readonly T[], filter: FeedFilter, coaches: ReadonlySet<string>): T[] {
  if (filter === 'coach') return posts.filter((p) => coaches.has(p.authorId));
  if (filter === 'wins') return posts.filter((p) => p.card !== null && p.card !== undefined);
  return [...posts];
}

const knownFirstName = (name: string | null | undefined): string | null => {
  const first = posterFirstName(name ?? '');
  return first === 'A former member' ? null : first;
};

/** "From Luis" for one coach (by full display name), "From coaches" for several. */
export function coachFilterLabel(coachNames: readonly string[]): string {
  if (coachNames.length > 1) return 'From coaches';
  const first = knownFirstName(coachNames[0]);
  return first ? `From ${first}` : 'From your coach';
}

/** The newest few comments (blocked members left out), oldest of them first so they read in order. */
export function commentPreview<T extends { authorId: string; createdAt: string; id: string }>(
  comments: readonly T[],
  blocked: ReadonlySet<string>,
  max = 2,
): T[] {
  const newestFirst = comments
    .filter((c) => !blocked.has(c.authorId))
    .sort((a, b) => (a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? 1 : -1) : a.id < b.id ? 1 : -1));
  return newestFirst.slice(0, max).reverse();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const commentCountLabel = (n: number): string => plural(n, 'comment', 'comments');
export const reactionCountLabel = (n: number): string => plural(n, 'reaction', 'reactions');

/** The link under a post's comment preview; null when there are no comments. */
export function viewAllCommentsLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? 'View 1 comment' : `View all ${count} comments`;
}

/** "Luis Bueno Coaching · 18 members", leaving out whatever isn't known. */
export function communitySubtitle(workspaceName: string | null, memberCount: number | null): string {
  return [workspaceName?.trim() || null, memberCount === null ? null : plural(memberCount, 'member', 'members')].filter(Boolean).join(' · ');
}

/** "Pinned by Luis", or just "Pinned" when who pinned it isn't known. */
export function pinnedByLabel(pinnerName: string | null): string {
  const first = knownFirstName(pinnerName);
  return first ? `Pinned by ${first}` : 'Pinned';
}
