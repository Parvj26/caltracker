// What the cards on the Today tab say, worked out from data other screens already load. Pure (no network, no React),
// so it is unit tested. PR, unit, sticker and body rules come from @caltracker/shared; this file only arranges them.
import { STICKERS, addDays, cardText, dayLabel, isoWeekday, localDateOf, topReactionsLine, type IsoDate, type Units } from '@caltracker/shared';
import type { AlbumAward } from './album-logic';
import { clockTime } from './chat-format';
import type { FeedPost } from './community-api';
import type { ProgressModel } from './progress';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/**
 * Where the Today tab's sticker card goes. The Zoo book is its own tab for now; when it moves inside Progress this is
 * the one place to change.
 */
export const zooHref = () => '/zoo' as const;

/** "Saturday 7 November", from the phone's own date (no locale data needed). */
export function headerDate(today: IsoDate): string {
  const [, m, d] = today.split('-').map(Number);
  return `${WEEKDAYS[isoWeekday(today) - 1]} ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/** "Hi Parv", or "Hi there" while the name isn't known. */
export function greeting(firstName: string | null): string {
  const name = firstName?.trim().split(/\s+/)[0];
  return name ? `Hi ${name}` : 'Hi there';
}

// ---- Coach -------------------------------------------------------------------------------------------------

type ChatItem = { body: string; imagePaths: string[]; createdAt: string; senderId?: string };

/** The newest message in the chat (sent, or still on its way from this phone), or null when there are none. */
export function coachPreview(items: readonly ChatItem[], me: string | null): { text: string; at: string } | null {
  let last: ChatItem | null = null;
  for (const i of items) if (!last || Date.parse(i.createdAt) >= Date.parse(last.createdAt)) last = i;
  if (!last) return null;
  const mine = last.senderId === undefined || last.senderId === me;
  const body = last.body.trim().replace(/\s+/g, ' ');
  const photos = last.imagePaths.length;
  const text = body || (photos > 1 ? `${photos} photos` : photos === 1 ? 'Photo' : 'Message');
  return { text: mine ? `You: ${text}` : text, at: last.createdAt };
}

/** "2:05 pm" for today, then "Yesterday", "Mon 2 Nov". */
export function previewTime(iso: string, nowIso: string, timeZone: string): string {
  const day = dayLabel(iso, nowIso, timeZone);
  return day === 'Today' ? clockTime(iso, timeZone) : day;
}

/** "2 unread messages" for VoiceOver. */
export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unread ${count === 1 ? 'message' : 'messages'}`;
}

// ---- Community ---------------------------------------------------------------------------------------------

export type PostPreview = {
  id: string;
  author: string;
  snippet: string;
  /** The top reactions and the comment count, e.g. "❤️ 2 · 🔥 1 · 1 comment"; '' with neither. */
  stats: string;
  /** The first photo's thumbnail path, if any. */
  thumbPath: string | null;
  /** Sticker art for a shared card without a photo. */
  stickerKey: string | null;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** One row in the Today community card. */
export function postPreview(post: FeedPost, ctx: { me: string; coaches: ReadonlySet<string>; units: Units }): PostPreview {
  const card = post.card ? cardText(post.card, ctx.units) : null;
  const body = post.body.trim().replace(/\s+/g, ' ');
  const snippet = body || (card ? `${card.badge} · ${card.title}` : post.images.length > 0 ? 'Shared a photo' : '');
  const author = post.authorId === ctx.me ? 'You' : ctx.coaches.has(post.authorId) ? `${post.authorName} · Coach` : post.authorName;
  const stats = [topReactionsLine(post.reactions) || null, post.commentCount > 0 ? plural(post.commentCount, 'comment') : null]
    .filter(Boolean)
    .join(' · ');
  return { id: post.id, author, snippet, stats, thumbPath: post.images[0]?.thumbPath ?? null, stickerKey: card?.stickerKey ?? null };
}

/** "See all · 2 new", or "See all". */
export function seeAllLabel(unread: number): string {
  return unread > 0 ? `See all · ${unread > 99 ? '99+' : unread} new` : 'See all';
}

/**
 * "Share today's workout" or "Share yesterday's workout". Null (no button) for a workout finished before yesterday,
 * or without a finish time: sharing is offered for two days only.
 */
export function shareWorkoutTitle(finishedAt: string | null, today: IsoDate, timeZone?: string): string | null {
  if (!finishedAt || Number.isNaN(Date.parse(finishedAt))) return null;
  const day = localDateOf(finishedAt, timeZone);
  if (day === today) return 'Share today’s workout';
  if (day === addDays(today, -1)) return 'Share yesterday’s workout';
  return null;
}

// ---- Stickers ----------------------------------------------------------------------------------------------

const stickerByKey = new Map(STICKERS.map((s) => [s.key, s]));

export type ZooSummary = {
  newest: { key: string; name: string; shiny: boolean; earnedAt: string } | null;
  owned: number;
  total: number;
  /** "Zoo 12 of 60" */
  label: string;
  /** 0 to 1, for the progress bar. */
  fraction: number;
};

/** The sticker first earned most recently, and how much of the whole zoo book is collected. */
export function zooSummary(awards: readonly AlbumAward[]): ZooSummary {
  const known = awards.filter((a) => stickerByKey.has(a.key));
  let newest: AlbumAward | null = null;
  for (const a of known) if (!newest || Date.parse(a.firstEarnedAt) > Date.parse(newest.firstEarnedAt)) newest = a;
  const owned = new Set(known.map((a) => a.key)).size;
  const total = STICKERS.length;
  return {
    newest: newest ? { key: newest.key, name: stickerByKey.get(newest.key)?.name ?? newest.key, shiny: newest.shiny, earnedAt: newest.firstEarnedAt } : null,
    owned,
    total,
    label: `Zoo ${owned} of ${total}`,
    fraction: total === 0 ? 0 : Math.min(1, owned / total),
  };
}

// ---- Goal and body -----------------------------------------------------------------------------------------

const SHORT_LABEL: Record<string, string> = { weight_kg: 'Weight', body_fat_pct: 'Body fat', smm_kg: 'Muscle' };

export type GoalCard = {
  goal: string | null;
  /** "48 days to go", "Today", "Passed 2 days ago"; null without a date. */
  countdown: string | null;
  tiles: { key: string; label: string; value: string; change: string | null }[];
};

/** The Today goal card from the Progress tab's model, or null (hidden) with no goal and no body numbers. */
export function goalCard(model: ProgressModel): GoalCard | null {
  if (!model.goal && model.latest.length === 0) return null;
  return {
    goal: model.goal?.text ?? null,
    countdown: model.goal?.countdown ?? null,
    tiles: model.latest.map((l) => ({ key: l.key, label: SHORT_LABEL[l.key] ?? l.label, value: l.value, change: l.delta })),
  };
}
