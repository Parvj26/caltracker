// The client's coach card (photo, name, business, bio, when they joined, the goal the coach set), kept on the phone so it shows without signal.
// Pure logic with injected fetch/sign functions so it can be unit tested; the network side is coach-profile-api.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { thumbPathOf } from '@caltracker/shared';

/** The goal the coach set on the client's Overview; targetDate (YYYY-MM-DD) drives the countdown. */
export type CoachGoal = { goal: string; targetDate: string | null };

export type CoachRecord = {
  name: string;
  businessName: string;
  bio: string;
  /** Storage path of the full photo ({coach id}/avatar.webp or .jpg), or null when there is none. */
  avatarPath: string | null;
  updatedAt: string | null;
  /** When the client joined the coach's workspace. Optional: copies saved before it was kept have none. */
  joinedAt?: string | null;
  /** Optional like joinedAt. */
  goal?: CoachGoal | null;
};

export type CoachProfile = {
  name: string;
  businessName: string;
  bio: string;
  /** A short-lived signed link to the thumbnail, or null (show initials). */
  avatarUrl: string | null;
  joinedAt: string | null;
  goal: CoachGoal | null;
};

/**
 * When the client joined the coach's workspace (the one the app is signed into, whose owner get_my_coach_profile
 * returns): that workspace's membership row, never another one; null when it is unknown.
 */
export function joinedAtIn(
  rows: ReadonlyArray<{ workspace_id: string; created_at: string | null }>,
  workspaceId: string | null,
): string | null {
  if (!workspaceId) return null;
  return rows.find((r) => r.workspace_id === workspaceId)?.created_at ?? null;
}

const key = (userId: string) => `caltracker.coach.${userId}`;

/** `?v=` changes with the profile's updated_at, so a replaced photo is never served from the image cache. */
export function withVersion(url: string, updatedAt: string | null): string {
  const version = updatedAt ? Date.parse(updatedAt) : 0;
  return `${url}${url.includes('?') ? '&' : '?'}v=${Number.isNaN(version) ? 0 : version}`;
}

function isGoal(v: unknown): v is CoachGoal {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return typeof g.goal === 'string' && (g.targetDate === null || typeof g.targetDate === 'string');
}

function isRecord(v: unknown): v is CoachRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (r.joinedAt === undefined || r.joinedAt === null || typeof r.joinedAt === 'string') &&
    (r.goal === undefined || r.goal === null || isGoal(r.goal)) &&
    typeof r.name === 'string' &&
    typeof r.businessName === 'string' &&
    typeof r.bio === 'string' &&
    (r.avatarPath === null || typeof r.avatarPath === 'string') &&
    (r.updatedAt === null || typeof r.updatedAt === 'string')
  );
}

async function readSaved(userId: string): Promise<CoachRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type Deps = { fetchFresh: () => Promise<CoachRecord | null>; signUrl: (path: string) => Promise<string>; now?: () => number };

/** Links are signed for an hour (coach-profile-api); one is reused for 45 minutes, so it never expires on screen. */
const REUSE_LINK_MS = 45 * 60 * 1000;
// The last photo link, by user, photo and version: reloading the card (each time the Coach tab opens) keeps the same link,
// so the image isn't downloaded again.
let lastLink: { key: string; url: string; at: number } | null = null;

/** Drops the remembered photo link (tests; a fresh sign-in starts clean anyway). */
export function forgetSignedLinks(): void {
  lastLink = null;
}

async function toProfile(userId: string, record: CoachRecord, deps: Deps): Promise<CoachProfile> {
  let avatarUrl: string | null = null;
  if (record.avatarPath) {
    const now = (deps.now ?? Date.now)();
    const linkKey = `${userId}|${record.avatarPath}|${record.updatedAt ?? ''}`;
    try {
      if (lastLink && lastLink.key === linkKey && now - lastLink.at < REUSE_LINK_MS) {
        avatarUrl = lastLink.url;
      } else {
        avatarUrl = withVersion(await deps.signUrl(thumbPathOf(record.avatarPath)), record.updatedAt);
        lastLink = { key: linkKey, url: avatarUrl, at: now };
      }
    } catch {
      avatarUrl = null; // initials show instead
    }
  }
  return {
    name: record.name,
    businessName: record.businessName,
    bio: record.bio,
    avatarUrl,
    joinedAt: record.joinedAt ?? null,
    goal: record.goal ?? null,
  };
}

/**
 * The coach card. Fresh from the server when possible (and saved); otherwise the copy saved on the phone;
 * null when neither exists. `fetchFresh` resolves null when the client has no coach and throws when it cannot ask.
 */
export async function loadCoachProfile(
  userId: string,
  deps: Deps,
): Promise<CoachProfile | null> {
  let record: CoachRecord | null;
  try {
    record = await deps.fetchFresh();
  } catch {
    const saved = await readSaved(userId);
    return saved ? toProfile(userId, saved, deps) : null;
  }
  try {
    if (record) await AsyncStorage.setItem(key(userId), JSON.stringify(record));
    else await AsyncStorage.removeItem(key(userId));
  } catch {
    // saving is a bonus
  }
  return record ? toProfile(userId, record, deps) : null;
}
