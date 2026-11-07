// What the sticker reveal shows, and the queue of reveals that could not be shown yet. Pure (no network, no
// React), so it is unit tested. The server call lives in awards.ts.
//
// Rules for the cards come from @caltracker/shared (pickLadderAnimal, revealCards, STICKERS); this file only turns
// them into the words and the order on screen.
import {
  STICKERS,
  formatMultiple,
  formatLogVolume,
  ladderHistoryBefore,
  logVolumeKg,
  pickLadderAnimal,
  revealCards,
  type AwardResult,
  type LadderAward,
  type LadderPick,
  type Units,
  type WorkoutLogDoc,
} from '@caltracker/shared';
import type { KeyValueStorage } from './log-store';

export const NEW_PILL = 'NEW for your zoo book';
/** A reveal nobody could collect for this long is dropped (the log never uploaded, or the server never answered). */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type RevealCardView = {
  /** Stable per card, so a card remounts (and its pop plays) when it changes. */
  id: string;
  type: 'ladder' | 'drop' | 'rare' | 'landmark' | 'milestone';
  /** Sticker art key; null for a milestone, which shows its number instead. */
  stickerKey: string | null;
  /** Small line above the sticker: "You lifted 3,240 lb" on the ladder card, "Surprise!" for a late one. */
  lead: string;
  /** "that's about" on the ladder card. */
  lead2: string | null;
  headline: string;
  pill: string | null;
  fact: string | null;
  shiny: boolean;
};

const byKey = new Map(STICKERS.map((s) => [s.key, s]));
const nameOf = (key: string) => byKey.get(key)?.name ?? key;
const factOf = (key: string) => byKey.get(key)?.fact ?? null;

/** "≈ 1.4 Giraffes" -> "1.4 Giraffes". */
const withoutApprox = (s: string) => s.replace(/^≈\s*/, '');

function ladderView(
  volumeKg: number,
  units: Units,
  ladder: { key: string; multiple: number; isNew: boolean; count: number; shiny: boolean },
  surprise: boolean,
): RevealCardView {
  const name = nameOf(ladder.key);
  const repeat = !ladder.isNew;
  const headline = ladder.shiny
    ? `✦ Shiny ${name.toLowerCase()}!`
    : repeat
      ? `Another ${name.toLowerCase()}! ×${ladder.count}`
      : `${withoutApprox(formatMultiple(ladder.multiple, name))}!`;
  return {
    id: `ladder:${ladder.key}`,
    type: 'ladder',
    stickerKey: ladder.key,
    lead: surprise ? 'Surprise!' : `You lifted ${formatLogVolume(volumeKg, units).replace(/ lifted$/, '')}`,
    lead2: surprise ? null : 'that’s about',
    headline,
    pill: ladder.isNew ? NEW_PILL : null,
    fact: factOf(ladder.key),
    shiny: ladder.shiny,
  };
}

/**
 * The animal this phone expects the server to pick for the log: the same shared rule, seeded by the same log id,
 * with the client's ladder awards of the logs finished before it (ladderAwards: the server's, plus the phone's own
 * previews it has not awarded yet).
 */
export function previewLadder(log: WorkoutLogDoc, ladderAwards: readonly LadderAward[]): LadderPick | null {
  const history = log.finishedAt
    ? ladderHistoryBefore(ladderAwards, { id: log.id, finishedAt: log.finishedAt })
    : ladderAwards.map((a) => a.key);
  return pickLadderAnimal(logVolumeKg(log), history, log.id);
}

/**
 * The cards to show, in order. The ladder card comes from this phone's own log at once (so it shows with no
 * signal, without a pill, because only the server knows whether the animal is new); when the server's award is
 * there, its ladder fields replace that and its drop, rare finds, landmarks and milestone follow.
 * A log with no weighted sets has no ladder card.
 */
export function buildRevealCards(
  log: WorkoutLogDoc,
  award: AwardResult | null,
  units: Units,
  ladderAwards: readonly LadderAward[],
): RevealCardView[] {
  const volumeKg = logVolumeKg(log);
  const cards: RevealCardView[] = [];

  const local = previewLadder(log, ladderAwards);
  const ladder =
    award?.ladder ??
    (local
      ? { key: local.sticker.key, multiple: local.multiple, isNew: false, count: 0, shiny: false }
      : null);
  if (ladder) {
    const view = ladderView(volumeKg, units, ladder, false);
    // Before the server answers nothing is known about "new" or "×N": a plain "1.4 Giraffes!", no pill.
    if (!award?.ladder) view.headline = `${withoutApprox(formatMultiple(ladder.multiple, nameOf(ladder.key)))}!`;
    cards.push(view);
  }
  if (award) cards.push(...extraCards(award, false));
  return cards;
}

/** Every card after the ladder one. `surprise` titles them "Surprise!" (collected on a later app open). */
function extraCards(award: AwardResult, surprise: boolean): RevealCardView[] {
  const out: RevealCardView[] = [];
  for (const c of revealCards(award)) {
    if (c.type === 'ladder') continue;
    if (c.type === 'milestone') {
      out.push({
        id: `milestone:${c.value}`,
        type: 'milestone',
        stickerKey: null,
        lead: surprise ? 'Surprise!' : 'Milestone!',
        lead2: null,
        headline: `Workout #${c.value}!`,
        pill: null,
        fact: null,
        shiny: false,
      });
      continue;
    }
    const key = c.key ?? '';
    out.push({
      id: `${c.type}:${key}`,
      type: c.type,
      stickerKey: key,
      lead: surprise ? 'Surprise!' : c.type === 'drop' ? 'A surprise visitor!' : c.type === 'rare' ? 'Rare find!' : 'Landmark reached!',
      lead2: null,
      headline: `${nameOf(key)}!`,
      pill: c.type === 'landmark' ? null : NEW_PILL,
      fact: factOf(key),
      shiny: false,
    });
  }
  return out;
}

/**
 * The cards for an award collected later ("Surprise!"): the ladder animal was already shown when the workout
 * finished, so it comes back only if it turned out shiny.
 */
export function surpriseCards(award: AwardResult, units: Units, volumeKg: number): RevealCardView[] {
  const cards: RevealCardView[] = [];
  if (award.ladder?.shiny) cards.push({ ...ladderView(volumeKg, units, award.ladder, true), lead2: null });
  cards.push(...extraCards(award, true));
  return cards;
}

// ---- the ladder history ---------------------------------------------------------------------------------
// The preview needs the animals the client was awarded before, like the server. The phone keeps the server's list
// (refreshed whenever there is signal) and its own previews of workouts the server hasn't awarded yet, so two
// workouts in a row with no signal still preview what the server will pick.

/** `server`: the client's ladder awards with this coach, as last read. `local`: this phone's unconfirmed previews. */
export type LadderCache = { server: LadderAward[]; local: LadderAward[] };

export const emptyLadderCache: LadderCache = { server: [], local: [] };

export const ladderCacheKey = (userId: string, workspaceId: string) => `caltracker.ladderAwards.${userId}.${workspaceId}`;

function isLadderAward(v: unknown): v is LadderAward {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.logId === 'string' && typeof a.finishedAt === 'string' && typeof a.key === 'string';
}

/** The saved history, or an empty one when there is none or it is unreadable. */
export function parseLadderCache(raw: string | null): LadderCache {
  if (!raw) return emptyLadderCache;
  try {
    const v = JSON.parse(raw) as { server?: unknown; local?: unknown };
    if (!Array.isArray(v.server) || !Array.isArray(v.local)) return emptyLadderCache;
    if (!v.server.every(isLadderAward) || !v.local.every(isLadderAward)) return emptyLadderCache;
    return { server: v.server, local: v.local };
  } catch {
    return emptyLadderCache;
  }
}

/** The server's list replaces the old one; previews of logs it now has an award for are dropped. */
export function withServerAwards(cache: LadderCache, server: LadderAward[]): LadderCache {
  const known = new Set(server.map((a) => a.logId));
  return { server, local: cache.local.filter((a) => !known.has(a.logId)) };
}

/** Remembers the phone's preview for a log (replacing an earlier one for the same log). */
export function withLocalPick(cache: LadderCache, pick: LadderAward): LadderCache {
  return { ...cache, local: [...cache.local.filter((a) => a.logId !== pick.logId), pick] };
}

/** Every ladder award to count: the server's, then previews it doesn't have yet that are under a week old. */
export function ladderAwardsFrom(cache: LadderCache, nowMs: number): LadderAward[] {
  const known = new Set(cache.server.map((a) => a.logId));
  const fresh = cache.local.filter((a) => !known.has(a.logId) && nowMs - Date.parse(a.finishedAt) <= PENDING_MAX_AGE_MS);
  return [...cache.server, ...fresh];
}

// ---- the pending queue ----------------------------------------------------------------------------------

/** A finished workout whose award the phone hasn't shown yet. `result` is null until the server has answered. */
export type PendingReveal = { logId: string; at: string; volumeKg: number; result: AwardResult | null };

export const pendingKey = (userId: string) => `caltracker.pendingReveals.${userId}`;

export type RevealQueue = {
  list(): Promise<PendingReveal[]>;
  /** Adds the entry, or merges into the one with the same logId: a known result is never replaced by null. */
  add(entry: PendingReveal): Promise<void>;
  remove(logId: string): Promise<void>;
};

function isPending(v: unknown): v is PendingReveal {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.logId === 'string' && typeof e.at === 'string' && typeof e.volumeKg === 'number';
}

export function createRevealQueue(storage: KeyValueStorage, userId: string): RevealQueue {
  const key = pendingKey(userId);
  const read = async (): Promise<PendingReveal[]> => {
    try {
      const raw = await storage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isPending) : [];
    } catch {
      return [];
    }
  };
  // One write at a time, so two adds can't overwrite each other.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    list: () => serial(read),
    add: (entry) =>
      serial(async () => {
        const all = await read();
        const at = all.findIndex((e) => e.logId === entry.logId);
        if (at === -1) all.push(entry);
        else all[at] = { ...all[at], ...entry, result: entry.result ?? all[at].result };
        await storage.setItem(key, JSON.stringify(all));
      }),
    remove: (logId) =>
      serial(async () => {
        const all = await read();
        const left = all.filter((e) => e.logId !== logId);
        if (left.length === all.length) return;
        if (left.length === 0) await storage.removeItem(key);
        else await storage.setItem(key, JSON.stringify(left));
      }),
  };
}

// ---- classifying the award call ---------------------------------------------------------------------------

/**
 * What to do with a failed award call. 'none': nothing to show and nothing to queue (the coach removed this
 * client). 'retry': the server doesn't have the finished log yet (still uploading), so ask again shortly.
 * 'later': queue it for the next app open.
 */
export function classifyAwardFailure(status: number | null, hint: string | null): 'none' | 'retry' | 'later' {
  if (status === 403 && hint === 'not_a_client') return 'none';
  if (status === 404 || status === 409) return 'retry';
  return 'later';
}

/** True when a pending entry is too old to keep trying. */
export const expired = (e: PendingReveal, nowMs: number) => nowMs - Date.parse(e.at) > PENDING_MAX_AGE_MS;

// ---- the summary's sticker row and PR pills ----------------------------------------------------------------

export type SummarySticker = { key: string; label: string; shiny: boolean };

/** The stickers this workout earned, for the summary's row: the ladder animal with its count, then the rest. */
export function summaryStickers(award: AwardResult): SummarySticker[] {
  const out: SummarySticker[] = [];
  if (award.ladder) {
    out.push({
      key: award.ladder.key,
      label: `${nameOf(award.ladder.key)} ×${award.ladder.count}`,
      shiny: award.ladder.shiny,
    });
  }
  for (const key of [award.drop ?? [], award.rare, award.landmarks].flat()) out.push({ key, label: nameOf(key), shiny: false });
  return out;
}

const PR_KIND: Record<string, string> = { heaviest: 'heaviest', reps_at_weight: 'most reps', e1rm: 'best estimated max' };

/** "Bench press: heaviest" for each personal best this workout set. */
export function prPills(award: AwardResult, log: WorkoutLogDoc): string[] {
  const names = new Map<string, string>();
  for (const b of log.blocks) for (const ex of b.exercises) names.set(ex.exerciseId, ex.exerciseName);
  return award.prs.map((p) => `${names.get(p.exerciseId) ?? 'Exercise'}: ${PR_KIND[p.kind] ?? p.kind}`);
}
