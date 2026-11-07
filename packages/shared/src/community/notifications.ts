import { groupedLikeText } from './likes';

// The in-app notifications list. Rows come from community_notifications (written by database triggers). Likes on the
// same post are grouped into one line; everything else is one line each. A push sender (later) can use the same text.

export type NotificationKind = 'comment' | 'like' | 'coach_post' | 'report';

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  postId: string | null;
  commentId: string | null;
  actorId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationItem = {
  /** Stable key for lists: the newest row's id. */
  key: string;
  kind: NotificationKind;
  postId: string | null;
  /** Everyone involved, newest first, without repeats. */
  actorIds: string[];
  /** The newest row's time. */
  createdAt: string;
  unread: boolean;
  /** The ids of every row in the group (to mark read). */
  ids: string[];
};

/**
 * Groups rows newest first. Likes on one post become one item (unread if any of them is); other kinds stay one item
 * per row. Rows from people the reader blocked are dropped (the database hides them too).
 */
export function groupNotifications(rows: readonly NotificationRow[], blocked: ReadonlySet<string> = new Set()): NotificationItem[] {
  const sorted = rows
    .filter((r) => r.actorId === null || !blocked.has(r.actorId))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  const out: NotificationItem[] = [];
  const likeGroups = new Map<string, NotificationItem>();
  for (const r of sorted) {
    if (r.kind === 'like' && r.postId) {
      const group = likeGroups.get(r.postId);
      if (group) {
        if (r.actorId && !group.actorIds.includes(r.actorId)) group.actorIds.push(r.actorId);
        group.unread ||= r.readAt === null;
        group.ids.push(r.id);
        continue;
      }
      const item: NotificationItem = {
        key: r.id,
        kind: 'like',
        postId: r.postId,
        actorIds: r.actorId ? [r.actorId] : [],
        createdAt: r.createdAt,
        unread: r.readAt === null,
        ids: [r.id],
      };
      likeGroups.set(r.postId, item);
      out.push(item);
      continue;
    }
    out.push({
      key: r.id,
      kind: r.kind,
      postId: r.postId,
      actorIds: r.actorId ? [r.actorId] : [],
      createdAt: r.createdAt,
      unread: r.readAt === null,
      ids: [r.id],
    });
  }
  return out;
}

/** The badge number: unread items after grouping (5 likes on one post count once). */
export function unreadNotificationCount(items: readonly NotificationItem[]): number {
  return items.filter((i) => i.unread).length;
}

/** "99+" above 99; null for none (no badge). */
export function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

/** The words for one item. `nameOf` turns a user id into a display name. */
export function notificationText(item: NotificationItem, nameOf: (userId: string) => string): string {
  const names = item.actorIds.map(nameOf);
  const first = names[0] ?? 'Someone';
  switch (item.kind) {
    case 'like':
      return groupedLikeText(names, item.actorIds.length);
    case 'comment':
      return `${first} commented on your post`;
    case 'coach_post':
      return `${first} posted in the community`;
    case 'report':
      return `${first} reported something in the community`;
  }
}
