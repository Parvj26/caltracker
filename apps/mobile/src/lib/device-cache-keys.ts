// The keys of what this phone saves for an account and forgets on Sign out. Pure, so it is unit tested.
import { albumCachePrefix } from './album-logic';

/** Every copy the Today tab saves starts with this (name, posts per community, PRs per coach). */
export const TODAY_CACHE_PREFIX = 'caltracker.today.';

/** One Today copy for this user: `caltracker.today.<what>.<userId>`. */
export const todayCacheKey = (what: string, userId: string) => `${TODAY_CACHE_PREFIX}${what}.${userId}`;

/** This user's saved food log copies (one per coach): `caltracker.food.<userId>.<workspaceId>`. Not the send queue. */
export const foodCachePrefix = (userId: string) => `caltracker.food.${userId}.`;

/**
 * The saved keys Sign out removes: this user's sticker book copies (one per coach, plus the older single copy), their
 * food log copies, and
 * every Today copy on the phone, whoever it belongs to (they only decorate Today, and a shared phone must not keep
 * the last account's name or posts).
 */
export function keysToForget(allKeys: readonly string[], userId: string | null): string[] {
  const album = userId ? albumCachePrefix(userId) : null;
  const food = userId ? foodCachePrefix(userId) : null;
  return allKeys.filter(
    (k) =>
      k.startsWith(TODAY_CACHE_PREFIX) ||
      (album !== null && (k === album || k.startsWith(`${album}.`))) ||
      (food !== null && k.startsWith(food)),
  );
}
