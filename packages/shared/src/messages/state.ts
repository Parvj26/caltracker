type Stamped = { senderId: string; createdAt: string };

/** Messages from the other person that arrived after I last read the thread. */
export function unreadCount(messages: Stamped[], me: string, myLastReadAt: string | null): number {
  const readAt = myLastReadAt === null ? -Infinity : Date.parse(myLastReadAt);
  return messages.filter((m) => m.senderId !== me && Date.parse(m.createdAt) > readAt).length;
}

/** The id of my latest message the other person has read ("Seen"), or null. */
export function seenMessageId<T extends Stamped & { id: string }>(
  messages: T[],
  me: string,
  theirLastReadAt: string | null,
): string | null {
  if (theirLastReadAt === null) return null;
  const readAt = Date.parse(theirLastReadAt);
  let best: T | null = null;
  for (const m of messages) {
    if (m.senderId !== me || Date.parse(m.createdAt) > readAt) continue;
    if (best === null || Date.parse(m.createdAt) >= Date.parse(best.createdAt)) best = m;
  }
  return best === null ? null : best.id;
}
