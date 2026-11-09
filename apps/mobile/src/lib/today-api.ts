// Server reads for the cards on the Today tab that no other screen already keeps: my first name and the community's
// newest posts. Each keeps a copy on the phone so Today works without signal. Reads go through RLS (a client sees only their own rows).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withoutBlocked } from '@caltracker/shared';
import { todayCacheKey } from './device-cache-keys';
import { loadLatestPosts, type FeedPost } from './community-api';
import { supabase } from './supabase';

/** Read a few more than shown, so a blocked member's post doesn't leave the card short. */
const POSTS_READ = 6;
export const POSTS_SHOWN = 2;

const key = todayCacheKey;

async function readJson(k: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function writeJson(k: string, value: unknown): void {
  // The copy on the phone is a convenience: never fail a screen over it.
  void AsyncStorage.setItem(k, JSON.stringify(value)).catch(() => undefined);
}

// ---- My first name ------------------------------------------------------------------------------------------

export async function readCachedFirstName(userId: string): Promise<string | null> {
  const v = await readJson(key('name', userId));
  return typeof v === 'string' ? v : null;
}

export async function fetchFirstName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('first_name').eq('id', userId).maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  const name = data?.first_name?.trim() || null;
  if (name) writeJson(key('name', userId), name);
  return name;
}

// ---- Community ----------------------------------------------------------------------------------------------

const isPost = (v: unknown): v is FeedPost =>
  typeof v === 'object' && v !== null && typeof (v as FeedPost).id === 'string' && Array.isArray((v as FeedPost).images);

export async function readCachedPosts(userId: string, communityId: string): Promise<FeedPost[] | null> {
  const v = await readJson(key(`posts.${communityId}`, userId));
  return Array.isArray(v) && v.every(isPost) ? v : null;
}

/**
 * The newest posts by time, pinned or not, without anyone I blocked. A pinned post is not moved to the top here (Today
 * shows what is new; the Community screen shows pins first). Throws when the server can't be reached.
 */
export async function fetchLatestPosts(userId: string, communityId: string, blocked: ReadonlySet<string>): Promise<FeedPost[]> {
  // Already newest first (loadLatestPosts orders by time only).
  const posts = withoutBlocked(await loadLatestPosts(communityId, POSTS_READ), blocked).slice(0, POSTS_SHOWN);
  writeJson(key(`posts.${communityId}`, userId), posts);
  return posts;
}
