// The client's coach card (photo, name, business, bio), kept on the phone so it shows without signal.
// Pure logic with injected fetch/sign functions so it can be unit tested; the network side is coach-profile-api.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { thumbPathOf } from '@caltracker/shared';

export type CoachRecord = {
  name: string;
  businessName: string;
  bio: string;
  /** Storage path of the full photo ({coach id}/avatar.webp or .jpg), or null when there is none. */
  avatarPath: string | null;
  updatedAt: string | null;
};

export type CoachProfile = {
  name: string;
  businessName: string;
  bio: string;
  /** A short-lived signed link to the thumbnail, or null (show initials). */
  avatarUrl: string | null;
};

const key = (userId: string) => `caltracker.coach.${userId}`;

/** `?v=` changes with the profile's updated_at, so a replaced photo is never served from the image cache. */
export function withVersion(url: string, updatedAt: string | null): string {
  const version = updatedAt ? Date.parse(updatedAt) : 0;
  return `${url}${url.includes('?') ? '&' : '?'}v=${Number.isNaN(version) ? 0 : version}`;
}

function isRecord(v: unknown): v is CoachRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
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

async function toProfile(record: CoachRecord, signUrl: (path: string) => Promise<string>): Promise<CoachProfile> {
  let avatarUrl: string | null = null;
  if (record.avatarPath) {
    try {
      avatarUrl = withVersion(await signUrl(thumbPathOf(record.avatarPath)), record.updatedAt);
    } catch {
      avatarUrl = null; // initials show instead
    }
  }
  return { name: record.name, businessName: record.businessName, bio: record.bio, avatarUrl };
}

/**
 * The coach card. Fresh from the server when possible (and saved); otherwise the copy saved on the phone;
 * null when neither exists. `fetchFresh` resolves null when the client has no coach and throws when it cannot ask.
 */
export async function loadCoachProfile(
  userId: string,
  deps: { fetchFresh: () => Promise<CoachRecord | null>; signUrl: (path: string) => Promise<string> },
): Promise<CoachProfile | null> {
  let record: CoachRecord | null;
  try {
    record = await deps.fetchFresh();
  } catch {
    const saved = await readSaved(userId);
    return saved ? toProfile(saved, deps.signUrl) : null;
  }
  try {
    if (record) await AsyncStorage.setItem(key(userId), JSON.stringify(record));
    else await AsyncStorage.removeItem(key(userId));
  } catch {
    // saving is a bonus
  }
  return record ? toProfile(record, deps.signUrl) : null;
}
