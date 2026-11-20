// What the cards on the Today tab say, worked out from data other screens already load. Pure (no network, no React),
// so it is unit tested. PR, unit, sticker and body rules come from @caltracker/shared; this file only arranges them.
import {
  STICKERS,
  ageLabel,
  cardText,
  dailyTotals,
  diffDays,
  formatMacro,
  isoWeekday,
  type IsoDate,
  type MacroTargets,
  type MealMacros,
  type SetRange,
  setRangeText,
  type Units,
  type WeekSummary,
} from '@caltracker/shared';
import type { AlbumAward } from './album-logic';
import type { FeedPost } from './community-api';
import { formatDayLabel } from './workouts';
import type { ProgramDay } from './workouts-plan';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Where the Today tab's sticker card goes: the Zoo book screen. One helper for every Zoo link (see zoo-href.ts). */
export { zooHref } from './zoo-href';

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


/** "2 unread messages" for VoiceOver. */
export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return `${count} unread ${count === 1 ? 'message' : 'messages'}`;
}

// ---- Community ---------------------------------------------------------------------------------------------

/** Who posted and what, for the Today Community line. */
export type PostPreview = { author: string; snippet: string };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The newest post, as the Today Community line reads it. */
export function postPreview(post: FeedPost, ctx: { me: string; coaches: ReadonlySet<string>; units: Units }): PostPreview {
  const mine = post.authorId === ctx.me;
  // A card's headline is a sentence about the poster ("You lifted 1,540 lb — …"); older workout cards have the
  // workout's name instead, so their label goes first.
  const card = post.card ? cardText(post.card, ctx.units, mine ? 'You' : post.authorName) : null;
  const body = post.body.trim().replace(/\s+/g, ' ');
  const cardLine = card ? (card.badge && post.card?.kind === 'workout' ? `${card.badge} · ${card.title}` : card.title) : null;
  const snippet = body || (cardLine ?? (post.images.length > 0 ? 'Shared a photo' : ''));
  const author = mine ? 'You' : ctx.coaches.has(post.authorId) ? `${post.authorName} · Coach` : post.authorName;
  return { author, snippet };
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

// ---- The redesigned Today (approved boards: workout day, rest day, new client) ------------------------------

const firstWord = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || null;

/** "Welcome, Parv" for a new client, or "Welcome" while the name isn't known. */
export function welcome(firstName: string | null): string {
  const name = firstWord(firstName);
  return name ? `Welcome, ${name}` : 'Welcome';
}

/**
 * "5 exercises · 18–19 sets · about 45 min" (approved Main board; sets by the shared rule, so Today, the preview and
 * the logger agree); only the count until the plan is loaded (`plan` null).
 */
export function workoutMeta(exercises: number, plan: { sets: SetRange; minutes: number } | null): string {
  return [plural(exercises, 'exercise'), plan ? setRangeText(plan.sets) : null, plan ? `about ${plan.minutes} min` : null]
    .filter(Boolean)
    .join(' · ');
}

/** "Next: Upper Push on Saturday" on a rest day (nextUpDay words the day). */
export function restNextLine(name: string, date: IsoDate, today: IsoDate): string {
  return `Next: ${name} on ${nextUpDay(date, today)}`;
}

/** "Preview Saturday" (or "Preview Tue 24 Nov"). */
export function restPreviewLabel(date: IsoDate, today: IsoDate): string {
  return `Preview ${nextUpDay(date, today)}`;
}

/** The goal strip: "49 days", "1 day", or the countdown's words ("Today", "Passed 3 days ago"). */
export function goalStripDays(countdown: { number: string | null; label: string } | null): string | null {
  if (!countdown) return null;
  if (countdown.number === null) return countdown.label;
  return `${countdown.number} ${countdown.number === '1' ? 'day' : 'days'}`;
}

/** "17 of 19 sets · 2 new bests" on the done row (the bests only once known, and only when there are some). */
export function doneLine(sets: string | null, newBests: number | null, duration: string): string {
  const bests = newBests && newBests > 0 ? `${newBests} new ${newBests === 1 ? 'best' : 'bests'}` : null;
  return [sets ?? duration, bests].filter(Boolean).join(' · ');
}

/** "Week 2 · Day 1" for a program workout; null for a one-off. */
export function programChip(day: ProgramDay | null): string | null {
  return day ? `Week ${day.week} · Day ${day.day}` : null;
}

/** "Wednesday" for the next workout within the coming week, else its date ("Tue 17 Nov"). */
export function nextUpDay(date: IsoDate, today: IsoDate): string {
  const ahead = diffDays(today, date);
  return ahead >= 1 && ahead <= 6 ? WEEKDAYS[isoWeekday(date) - 1] ?? formatDayLabel(date) : formatDayLabel(date);
}

export type FoodBar = {
  /** "1,240 / 2,100" (calories) or "96 / 170 g"; without a target just the total ("1,240 kcal"). */
  value: string;
  /** 0 to 1 against the target; null (no bar) without one. */
  fraction: number | null;
  /** For VoiceOver: "Calories 1,240 of 2,100 kcal". */
  label: string;
};

function foodBar(key: 'calories' | 'protein', total: number, target: number | null): FoodBar {
  const name = key === 'calories' ? 'Calories' : 'Protein';
  const plain = formatMacro(key, total);
  if (target === null || target <= 0) return { value: plain, fraction: null, label: `${name} ${plain}` };
  const bare = plain.replace(/ (kcal|g)$/, '');
  const goal = formatMacro(key, target);
  const goalBare = goal.replace(/ (kcal|g)$/, '');
  return {
    value: key === 'calories' ? `${bare} / ${goalBare}` : `${bare} / ${goal}`,
    fraction: Math.max(0, Math.min(1, total / target)),
    label: `${name} ${bare} of ${goal}`,
  };
}

export type FoodPart = { strong: string; rest: string };

/**
 * Today's food line (approved Main board): "1,550 kcal left · 92 g protein to go" against the coach's targets, or the
 * plain numbers with no targets ("1,240 kcal · 86 g protein today"), never empty bars. Totals from shared dailyTotals.
 */
export function foodLine(meals: ReadonlyArray<{ macros: MealMacros }>, targets: MacroTargets | null): { parts: FoodPart[]; label: string } {
  const totals = dailyTotals(meals.map((m) => m.macros));
  const kcalTarget = targets?.calories ?? null;
  const proteinTarget = targets?.protein ?? null;
  const parts: FoodPart[] = [];
  if (kcalTarget !== null && kcalTarget > 0) {
    const diff = Math.round(kcalTarget - totals.calories);
    parts.push(
      diff === 0
        ? { strong: 'Calories', rest: ' on target' }
        : { strong: formatMacro('calories', Math.abs(diff)), rest: diff > 0 ? ' left' : ' over' },
    );
  } else {
    parts.push({ strong: formatMacro('calories', totals.calories), rest: '' });
  }
  if (proteinTarget !== null && proteinTarget > 0) {
    const left = Math.round((proteinTarget - totals.protein) * 10) / 10;
    parts.push(left > 0 ? { strong: formatMacro('protein', left), rest: ' protein to go' } : { strong: formatMacro('protein', totals.protein), rest: ' protein · target hit' });
  } else {
    parts.push({ strong: formatMacro('protein', totals.protein), rest: ' protein' });
  }
  const noTargets = !(kcalTarget && kcalTarget > 0) && !(proteinTarget && proteinTarget > 0);
  if (noTargets) parts[parts.length - 1]!.rest += ' today';
  return { parts, label: parts.map((p) => p.strong + p.rest).join(', ') };
}

/** Today's food card: calories and protein against the coach's targets (totals from shared dailyTotals). */
export function foodCard(
  meals: ReadonlyArray<{ name: string | null; macros: MealMacros }>,
  targets: MacroTargets | null,
): { calories: FoodBar; protein: FoodBar; meals: string } {
  const totals = dailyTotals(meals.map((m) => m.macros));
  const names: string[] = [];
  const seen = new Set<string>();
  for (const m of meals) {
    const name = m.name?.trim() || 'Meal';
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return {
    calories: foodBar('calories', totals.calories, targets?.calories ?? null),
    protein: foodBar('protein', totals.protein, targets?.protein ?? null),
    meals: meals.length === 0 ? 'No meals logged yet' : `${plural(meals.length, 'meal')} logged · ${names.join(', ')}`,
  };
}

const AGO_UNIT: Record<string, string> = { m: 'min', h: 'h', d: 'd', w: 'wk', y: 'y' };

/** "just now", "5 min ago", "2 h ago", "3 d ago", "2 wk ago" (from shared ageLabel). */
export function agoText(iso: string, now: Date): string {
  const short = ageLabel(iso, now);
  const m = /^(\d+)([a-z])$/.exec(short);
  return m && m[1] && m[2] ? `${m[1]} ${AGO_UNIT[m[2]] ?? m[2]} ago` : 'just now';
}

/**
 * The "This week" tile from the shared week summary (the one Progress shows, so the two agree): "1 of 4" over
 * "workouts · +1 extra · 5-wk streak"; with nothing planned, the workouts done alone.
 */
export function weekTile(w: Pick<WeekSummary, 'done' | 'planned' | 'extra' | 'streak' | 'extraLine'>): { big: string; small: string } {
  const streakText = w.streak > 0 ? `${w.streak}-wk streak` : null;
  const count = w.planned > 0 ? w.planned : w.done + w.extra;
  if (count === 0) return { big: 'None planned', small: streakText ?? 'this week' };
  const big = w.planned > 0 ? `${w.done} of ${w.planned}` : String(count);
  return { big, small: [count === 1 ? 'workout' : 'workouts', w.extraLine, streakText].filter(Boolean).join(' · ') };
}

/** The Community line's headline from the newest post: "Sam set 2 new PRs", "Sam: Morning lift done". */
export function communityHeadline(row: Pick<PostPreview, 'author' | 'snippet'>): string {
  const who = row.author === 'You' ? 'You' : (firstWord(row.author.replace(/ · Coach$/, '')) ?? row.author);
  const snippet = row.snippet.trim();
  if (!snippet) return `${who} posted`;
  if (snippet === 'Shared a photo') return `${who} shared a photo`;
  if (snippet === who || snippet.startsWith(`${who} `)) return snippet;
  return `${who}: ${snippet}`;
}

/** "3 new" (unread community notifications), or null with none. */
export function newCountLabel(unread: number): string | null {
  return unread > 0 ? `${unread > 99 ? '99+' : unread} new` : null;
}

/** "What happens next" for a new client, naming the coach by first name. */
export function nextSteps(coachName: string | null): [string, string, string] {
  return [
    `${firstWord(coachName) ?? 'Your coach'} builds your plan and it appears here and in Workouts.`,
    'Tap Start, log each set, and finish. It takes a few taps.',
    'Earn stickers and watch your progress grow.',
  ];
}
