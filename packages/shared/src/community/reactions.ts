// Reactions on community posts and comments (spec: richer reactions replace the single Like). A fixed set of six; the
// database stores the key, never the emoji. A member can add any number of the six to a post or comment; tapping the
// same one again takes it back (like Slack).

export const REACTIONS = [
  { key: 'heart', emoji: '❤️', label: 'heart' },
  { key: 'muscle', emoji: '💪', label: 'muscle' },
  { key: 'fire', emoji: '🔥', label: 'fire' },
  { key: 'clap', emoji: '👏', label: 'clap' },
  { key: 'laugh', emoji: '😂', label: 'laugh' },
  { key: 'party', emoji: '🎉', label: 'party' },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]['key'];
export type ReactionInfo = (typeof REACTIONS)[number];

const BY_KEY = new Map<string, ReactionInfo>(REACTIONS.map((r) => [r.key, r]));

export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === 'string' && BY_KEY.has(value);
}

/** One reaction as loaded: who, which, when, and the display name ("Former member" for someone who left). */
export type ReactionRow = { userId: string; reaction: ReactionKey; createdAt: string; name: string };

export type ReactionSummary = ReactionInfo & {
  count: number;
  /** The viewer reacted with this one. */
  mine: boolean;
  /** Who reacted, newest first. */
  userIds: string[];
  names: string[];
};

/** The reaction bar: each used reaction in the fixed order, with its count and whether the viewer is among them. */
export function summarizeReactions(rows: readonly ReactionRow[], viewerId: string): ReactionSummary[] {
  const newestFirst = [...rows].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
  const out: ReactionSummary[] = [];
  for (const info of REACTIONS) {
    const userIds: string[] = [];
    const names: string[] = [];
    for (const r of newestFirst) {
      if (r.reaction !== info.key || userIds.includes(r.userId)) continue;
      userIds.push(r.userId);
      names.push(r.name);
    }
    if (userIds.length === 0) continue;
    out.push({ ...info, count: userIds.length, mine: userIds.includes(viewerId), userIds, names });
  }
  return out;
}

/** One tap as a change to one row, so a failed tap can be undone on its own (see invertReactionChange). */
export type ReactionChange = { op: 'add' | 'remove'; row: ReactionRow };

/** What a tap does: add the reaction as the newest if the viewer had not used it, or remove their row if they had. */
export function reactionTap(
  rows: readonly ReactionRow[],
  viewer: { userId: string; name: string },
  key: ReactionKey,
  nowIso: string,
): ReactionChange {
  const existing = rows.find((r) => r.userId === viewer.userId && r.reaction === key);
  if (existing) return { op: 'remove', row: existing };
  return { op: 'add', row: { userId: viewer.userId, reaction: key, createdAt: nowIso, name: viewer.name } };
}

const sameSlot = (a: ReactionRow, b: ReactionRow) => a.userId === b.userId && a.reaction === b.reaction;

/** Applies a change: an add never duplicates (one of each per person), a remove touches only that person's row. */
export function applyReactionChange(rows: readonly ReactionRow[], change: ReactionChange): ReactionRow[] {
  if (change.op === 'remove') return rows.filter((r) => !sameSlot(r, change.row));
  return rows.some((r) => sameSlot(r, change.row)) ? [...rows] : [...rows, change.row];
}

/** The change that undoes `change` (a failed add is removed; a failed remove is put back as it was). */
export function invertReactionChange(change: ReactionChange): ReactionChange {
  return { op: change.op === 'add' ? 'remove' : 'add', row: change.row };
}

/** The rows after the viewer taps a reaction: added as the newest if they had not used it, removed if they had. */
export function toggleReaction(
  rows: readonly ReactionRow[],
  viewer: { userId: string; name: string },
  key: ReactionKey,
  nowIso: string,
): ReactionRow[] {
  return applyReactionChange(rows, reactionTap(rows, viewer, key, nowIso));
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** "React with fire, 3 people", or "Remove your heart reaction, 1 person" when the viewer already used it. */
export function reactionButtonLabel(s: ReactionSummary): string {
  return s.mine ? `Remove your ${s.label} reaction, ${people(s.count)}` : `React with ${s.label}, ${people(s.count)}`;
}

/** The label of the count, which opens the list of who reacted. */
export function whoReactedLabel(s: ReactionSummary): string {
  return `See who reacted with ${s.label}`;
}

/**
 * Notifications: "Sam reacted to your post", "Sam and Kim reacted to your comment", "Sam and 4 others reacted to your
 * post". `names` are the people newest first (the first one is named); `total` is how many there are in all.
 */
export function groupedReactionText(names: readonly string[], total: number = names.length, object = 'your post'): string {
  const count = Math.max(total, names.length);
  const first = names[0] ?? 'Someone';
  if (count <= 1) return `${first} reacted to ${object}`;
  if (count === 2 && names[1]) return `${first} and ${names[1]} reacted to ${object}`;
  const others = count - 1;
  return `${first} and ${others} ${others === 1 ? 'other' : 'others'} reacted to ${object}`;
}
