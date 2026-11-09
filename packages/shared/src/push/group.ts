import { parsePushData } from './data';
import type { PushData, ServerPushType } from './data';

/** A pending push_outbox row as the sender reads it. */
export type OutboxRowInput = {
  id: string;
  userId: string;
  type: ServerPushType;
  groupKey: string;
  data: unknown;
  createdAt: string;
};

type GroupOf<T extends ServerPushType> = {
  /** Row ids, oldest first. */
  ids: string[];
  userId: string;
  type: T;
  groupKey: string;
  /** The newest row's data. */
  data: PushData[T];
  count: number;
  /** The oldest row's actorName ('' when the type has none). */
  firstActorName: string;
  /** Distinct actorIds (community activity), oldest first. */
  actorIds: string[];
  /** The oldest row's createdAt. */
  createdAt: string;
};

/** Rows of one user with the same group key, sent as one notification ("Sam and 4 others…"). */
export type OutboxGroup = { [T in ServerPushType]: GroupOf<T> }[ServerPushType];

const field = (data: unknown, key: string): string => {
  const v = (data as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};

/**
 * Collapses rows by (user, group key). Groups are ordered by their oldest row; rows whose data does not match their
 * type's shape are returned in `invalid` so the sender can mark them failed instead of sending them.
 */
export function groupOutbox(rows: readonly OutboxRowInput[]): { groups: OutboxGroup[]; invalid: string[] } {
  const invalid: string[] = [];
  const byKey = new Map<string, { row: OutboxRowInput; data: object }[]>();
  const sorted = [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
  for (const row of sorted) {
    const data = parsePushData(row.type, row.data);
    if (!data) {
      invalid.push(row.id);
      continue;
    }
    const key = JSON.stringify([row.userId, row.groupKey]);
    const list = byKey.get(key);
    if (list) list.push({ row, data });
    else byKey.set(key, [{ row, data }]);
  }
  const groups = [...byKey.values()].map((list) => {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const actorIds = [...new Set(list.map((x) => field(x.data, 'actorId')).filter((id) => id !== ''))];
    return {
      ids: list.map((x) => x.row.id),
      userId: first.row.userId,
      type: first.row.type,
      groupKey: first.row.groupKey,
      data: last.data,
      count: list.length,
      firstActorName: field(first.data, 'actorName').trim(),
      actorIds,
      createdAt: first.row.createdAt,
    } as OutboxGroup;
  });
  return { groups, invalid };
}
