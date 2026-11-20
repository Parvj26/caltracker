// Pure rules for the Coach tab (unit tested): the coach's profile lines and the chat's rows.
import { countdownLabel, dayLabel, localDateOf, type IsoDate, type Message, type OutboxItem } from '@caltracker/shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Replies the client can send with one tap, above the composer. */
export const QUICK_REPLIES = ['Done for today', 'Can we swap a day?', 'Something hurts'] as const;

/** "Luis" from "Luis Bueno"; null when there is no name. */
export function coachFirstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/** "Your coach since November 2026" from when the client joined the coach's workspace; null when unknown. */
export function coachSinceLabel(joinedAt: string | null | undefined, timeZone: string): string | null {
  if (!joinedAt || Number.isNaN(Date.parse(joinedAt))) return null;
  const [year, month] = localDateOf(joinedAt, timeZone).split('-').map(Number);
  const name = month ? MONTHS[month - 1] : undefined;
  return name && year ? `Your coach since ${name} ${year}` : null;
}

/** The goal card's countdown: "112" over "days to go", or words alone ("Today", "Passed 3 days ago"). */
export function goalCountdown(targetDate: IsoDate | null, today: IsoDate): { number: string | null; label: string } | null {
  if (!targetDate) return null;
  const label = countdownLabel(targetDate, today);
  const m = /^(\d+) (.+)$/.exec(label);
  return m?.[1] && m[2] ? { number: m[1], label: m[2] } : { number: null, label };
}

/** A coach's comment on one of the client's workouts, shown in the chat as a small card. */
export type WorkoutComment = {
  id: string;
  logId: string;
  body: string;
  createdAt: string;
  workoutName: string;
  /** When the workout was done (finished, else started). */
  workoutAt: string;
};

export type ChatRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; item: Message | OutboxItem }
  | { kind: 'comment'; key: string; title: string; comment: WorkoutComment };

type Timed = { at: number; row: ChatRow };

/**
 * The chat's rows, newest first (the list is inverted so it opens at the latest message): messages and workout
 * comments by time, with "Today" / "Yesterday" / "Mon 2 Nov" before each day. While earlier messages remain to load,
 * comments older than the oldest loaded message wait too, so they never show out of place.
 */
export function buildChatRows(input: {
  items: ReadonlyArray<Message | OutboxItem>;
  comments: ReadonlyArray<WorkoutComment>;
  hasMore: boolean;
  now: string;
  timeZone: string;
}): ChatRow[] {
  const { items, comments, hasMore, now, timeZone } = input;
  const oldest = items[0] ? Date.parse(items[0].createdAt) : null;
  const timed: Timed[] = items.map((item) => ({ at: Date.parse(item.createdAt), row: { kind: 'message', key: item.clientMsgId, item } }));
  for (const c of comments) {
    const at = Date.parse(c.createdAt);
    if (hasMore && oldest !== null && at < oldest) continue;
    const title = `${c.workoutName} · ${dayLabel(c.workoutAt, now, timeZone)}`;
    timed.push({ at, row: { kind: 'comment', key: `comment-${c.id}`, title, comment: c } });
  }
  // Stable: messages keep their order among themselves, and a comment at the same instant follows them.
  timed.sort((a, b) => a.at - b.at);

  const out: ChatRow[] = [];
  let last = '';
  for (const { at, row } of timed) {
    const iso = new Date(at).toISOString();
    const label = dayLabel(iso, now, timeZone);
    if (label !== last) {
      out.push({ kind: 'day', key: `day-${iso}`, label });
      last = label;
    }
    out.push(row);
  }
  return out.reverse();
}

/**
 * The quick replies show until the client answers: with no messages yet, or while the newest message is the
 * coach's. Anything the client sent (or is still sending) hides them; the coach's next message brings them back.
 */
export function showQuickReplies(items: ReadonlyArray<Message | OutboxItem>, me: string | null): boolean {
  const last = items[items.length - 1];
  if (!last) return true;
  if ('state' in last) return false;
  return last.senderId !== me;
}

export type StripCell = {
  key: 'goal' | 'meals' | 'community';
  label: string;
  value: string;
  /** A second line (a long goal's countdown, so it is never cut off). */
  detail?: string;
  accessibilityLabel: string;
};

/** Longest "goal · countdown" kept on one line in a third of a phone's width. */
const GOAL_ONE_LINE = 18;

/**
 * The strip under the chat header: GOAL "5K · 49 days", MEALS "3 from Luis" (or "None yet"), COMMUNITY "2 new" (or
 * "Open"). No goal hides the goal cell; no community hides that one. Meals always shows, so the strip is never empty.
 */
export function coachStrip(input: {
  goal: { goal: string; targetDate: IsoDate | null } | null;
  today: IsoDate;
  mealCount: number;
  firstName: string | null;
  hasCommunity: boolean;
  communityUnread: number;
}): StripCell[] {
  const out: StripCell[] = [];
  const goalText = input.goal?.goal.trim();
  if (input.goal && goalText) {
    const c = goalCountdown(input.goal.targetDate, input.today);
    const when = c ? (c.number ? `${c.number} ${c.label.replace(/ to go$/, '')}` : c.label) : null;
    const oneLine = when ? `${goalText} · ${when}` : goalText;
    const split = when !== null && oneLine.length > GOAL_ONE_LINE;
    out.push({
      key: 'goal',
      label: 'GOAL',
      value: split ? goalText : oneLine,
      ...(split && when ? { detail: when } : {}),
      accessibilityLabel: `Goal: ${goalText}${c ? `, ${c.number ? `${c.number} ${c.label}` : c.label}` : ''}`,
    });
  }
  const who = input.firstName ?? 'your coach';
  const meals = input.mealCount > 0 ? `${input.mealCount > 99 ? '99+' : input.mealCount} from ${who}` : 'None yet';
  out.push({
    key: 'meals',
    label: 'MEALS',
    value: meals,
    accessibilityLabel: input.mealCount > 0 ? `Meals from ${who}, ${input.mealCount === 1 ? '1 meal' : `${input.mealCount} meals`}` : `Meals from ${who}, none yet`,
  });
  if (input.hasCommunity) {
    const n = input.communityUnread;
    out.push({
      key: 'community',
      label: 'COMMUNITY',
      value: n > 0 ? `${n > 99 ? '99+' : n} new` : 'Open',
      accessibilityLabel: n > 0 ? `Community, ${n} new` : 'Community',
    });
  }
  return out;
}
