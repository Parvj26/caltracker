import { unreadCount } from '@caltracker/shared';

export const PHOTO_PREVIEW = '📷 Photo';

/** One line for the inbox: the text, or "📷 Photo" for a message that is only photos. */
export function previewOf(body: string, imagePaths: string[]): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text) return text;
  return imagePaths.length > 0 ? PHOTO_PREVIEW : '';
}

export type InboxRow = {
  clientId: string;
  name: string;
  conversationId: string | null;
  lastMessageAt: string | null;
  preview: string;
  /** True when the coach sent the latest message (shown as "You: ..."). */
  lastFromMe: boolean;
  unread: number;
};

type LatestMessage = { body: string; imagePaths: string[]; senderId: string };
type StampedMessage = { senderId: string; createdAt: string };

/**
 * Current clients as inbox rows: those with messages first (latest first), then those without, by name. The unread
 * count is the other person's messages after the coach's last read of that conversation.
 */
export function buildInbox(input: {
  me: string;
  clients: { id: string; name: string }[];
  conversations: { id: string; clientId: string; lastMessageAt: string | null }[];
  /** The latest message of each conversation, by conversation id. */
  latest: ReadonlyMap<string, LatestMessage>;
  /** Recent messages by conversation id, used to count unread. */
  recent: ReadonlyMap<string, StampedMessage[]>;
  /** The coach's last_read_at by conversation id. */
  reads: ReadonlyMap<string, string>;
  /** Unread counts worked out some other way (for conversations whose messages are not in `recent`). */
  unreadOverride?: ReadonlyMap<string, number>;
}): InboxRow[] {
  const byClient = new Map(input.conversations.map((c) => [c.clientId, c]));
  const rows = input.clients.map((client): InboxRow => {
    const conv = byClient.get(client.id);
    const last = conv ? input.latest.get(conv.id) : undefined;
    const unread = !conv
      ? 0
      : (input.unreadOverride?.get(conv.id) ?? unreadCount(input.recent.get(conv.id) ?? [], input.me, input.reads.get(conv.id) ?? null));
    return {
      clientId: client.id,
      name: client.name,
      conversationId: conv?.id ?? null,
      lastMessageAt: conv?.lastMessageAt ?? null,
      preview: last ? previewOf(last.body, last.imagePaths) : '',
      lastFromMe: last ? last.senderId === input.me : false,
      unread,
    };
  });
  return rows.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}

export function filterInbox(rows: InboxRow[], opts: { unreadOnly: boolean; query: string }): InboxRow[] {
  const q = opts.query.trim().toLowerCase();
  return rows.filter((r) => (!opts.unreadOnly || r.unread > 0) && (q === '' || r.name.toLowerCase().includes(q)));
}

/** "3", or "99+" past 99. */
export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

/**
 * Whether the reply box holds something to send: text or photos, and not only the text it was started with (a bare
 * "About your Lunch today (12:15 pm): " from the Food tab says nothing yet).
 */
export function canSendDraft(body: string, photoCount: number, startedWith = ''): boolean {
  if (photoCount > 0) return true;
  const text = body.trim();
  return text !== '' && text !== startedWith.trim();
}
