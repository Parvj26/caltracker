// What the Zoo tab shows, worked out from the client's sticker rows and stats. Presentation only (no network, no
// React), so it is unit tested. The rules (catalogue, requirements, journey) come from @caltracker/shared.
import {
  LANDMARK_JOURNEY,
  STICKERS,
  formatLogVolume,
  formatMultiple,
  liveStreak,
  type RareRequirement,
  type StickerDef,
  type Units,
} from '@caltracker/shared';

export type AlbumAward = { key: string; count: number; shiny: boolean; firstEarnedAt: string };
export type AlbumStats = {
  workouts: number;
  /** The streak as of the client's last awarded workout; see streakWeek. */
  streak: number;
  /** The Monday of the streak's last week (client_stats.streak_week), or null. */
  streakWeek: string | null;
  bestStreak: number;
  journeyWeek: number;
  prCount: number;
  lifetimeVolumeKg: number;
};
export type AlbumData = { awards: AlbumAward[]; stats: AlbumStats | null };

export type AlbumItem = {
  key: string;
  name: string;
  fact: string;
  kind: StickerDef['kind'];
  owned: boolean;
  count: number;
  shiny: boolean;
  /** "×3" when owned, else null. */
  badge: string | null;
  firstEarnedAt: string | null;
  /** What unlocks a locked rare find ("12-week streak"); null otherwise. */
  requirement: string | null;
};

export type AlbumModel = {
  journey: {
    streak: number;
    title: string;
    dots: { week: number; key: string; reached: boolean }[];
    next: { key: string; name: string; week: number } | null;
    nextLabel: string;
    collected: AlbumItem[];
  };
  animals: { title: string; items: AlbumItem[] };
  rare: { title: string; items: AlbumItem[] };
  drops: AlbumItem[];
};

const byKey = new Map(STICKERS.map((s) => [s.key, s]));

export function requirementText(req: RareRequirement, units: Units): string {
  switch (req.kind) {
    case 'workouts':
      return `${req.value} workouts`;
    case 'streak':
      return `${req.value}-week streak`;
    case 'prs':
      return `${req.value} personal bests`;
    case 'volume':
      return formatLogVolume(req.value, units);
  }
}

/**
 * `currentWeek` is this week's Monday on the phone: the stored streak is shown as it stands now (0 once a whole week
 * went by without a workout). Without it the stored streak is shown as is.
 */
export function albumModel(
  awards: readonly AlbumAward[],
  stats: AlbumStats | null,
  units: Units = 'kg',
  currentWeek?: string,
): AlbumModel {
  const owned = new Map(awards.filter((a) => byKey.has(a.key)).map((a) => [a.key, a]));
  const item = (def: StickerDef): AlbumItem => {
    const a = owned.get(def.key);
    return {
      key: def.key,
      name: def.name,
      fact: def.fact,
      kind: def.kind,
      owned: a !== undefined,
      count: a?.count ?? 0,
      shiny: a?.shiny ?? false,
      badge: a ? `×${a.count}` : null,
      firstEarnedAt: a?.firstEarnedAt ?? null,
      requirement: !a && def.requirement ? requirementText(def.requirement, units) : null,
    };
  };
  const ofKind = (kind: StickerDef['kind']) => STICKERS.filter((s) => s.kind === kind);

  const animals = ofKind('ladder')
    .slice()
    .sort((a, b) => (a.weightKg ?? 0) - (b.weightKg ?? 0))
    .map(item);
  const rare = ofKind('rare').map(item);
  const streak = !stats ? 0 : currentWeek ? liveStreak(stats.streak, stats.streakWeek, currentWeek) : stats.streak;
  const next = LANDMARK_JOURNEY.find((s) => s.week > streak) ?? null;

  return {
    journey: {
      streak,
      title: `🔥 ${streak}-week streak`,
      dots: LANDMARK_JOURNEY.map((s) => ({ ...s, reached: s.week <= streak })),
      next: next ? { key: next.key, name: byKey.get(next.key)?.name ?? next.key, week: next.week } : null,
      nextLabel: next ? `next: ${byKey.get(next.key)?.name ?? next.key}` : 'every landmark collected',
      collected: LANDMARK_JOURNEY.filter((s) => owned.has(s.key)).map((s) => item(byKey.get(s.key) as StickerDef)),
    },
    animals: {
      title: `${animals.filter((a) => a.owned).length} of ${animals.length} · Shiny ${animals.filter((a) => a.shiny).length} / ${animals.length}`,
      items: animals,
    },
    rare: { title: `${rare.filter((r) => r.owned).length} of ${rare.length}`, items: rare },
    drops: ofKind('drop').map(item),
  };
}

// ---- the copy kept on the phone ------------------------------------------------------------------------

/** Every saved copy of this user's book starts with this. */
export const albumCachePrefix = (userId: string) => `caltracker.album.${userId}`;
/** One saved copy per user and coach: a client who joins a new coach starts a fresh book there. */
export const albumCacheKey = (userId: string, workspaceId: string) => `${albumCachePrefix(userId)}.${workspaceId}`;

const isAward = (v: unknown): v is AlbumAward => {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.key === 'string' &&
    typeof a.count === 'number' &&
    typeof a.shiny === 'boolean' &&
    typeof a.firstEarnedAt === 'string'
  );
};

/** The saved album, or null when there is none or it is unreadable. */
export function parseAlbumCache(raw: string | null): AlbumData | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { awards?: unknown; stats?: unknown };
    if (!Array.isArray(v.awards) || !v.awards.every(isAward)) return null;
    const s = v.stats;
    const stats =
      typeof s === 'object' && s !== null && typeof (s as AlbumStats).streak === 'number'
        ? { ...(s as AlbumStats), streakWeek: typeof (s as AlbumStats).streakWeek === 'string' ? (s as AlbumStats).streakWeek : null }
        : null;
    return { awards: v.awards, stats };
  } catch {
    return null;
  }
}

/** "5 Nov 2026" in the phone's locale. */
export function formatEarned(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The share card's lines: "3,175 lb ≈ 1.2 Giraffes" for a workout's animal, or the sticker's own fact for one in the book. */
export function workoutShareLine(volumeKg: number, units: Units, multiple: number, animalName: string): string {
  const lifted = formatLogVolume(volumeKg, units).replace(/ lifted$/, '');
  return `${lifted} ${formatMultiple(multiple, animalName)}`;
}
