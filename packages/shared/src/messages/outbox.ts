import type { Message, OutboxItem } from './types';

/** Server messages plus outbox items the server has not echoed back yet, oldest first. */
export function mergeOutbox(server: Message[], outbox: OutboxItem[]): Array<Message | OutboxItem> {
  const known = new Set(server.map((m) => m.clientMsgId));
  const pending = outbox.filter((o) => !known.has(o.clientMsgId));
  const all: Array<Message | OutboxItem> = [...server, ...pending];
  // Array.prototype.sort is stable, so equal times keep server-first order.
  return all.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
