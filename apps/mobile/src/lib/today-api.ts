// Server reads for the cards on the Today tab that no other screen already keeps: my first name, the community's
// newest posts, my last finished workout (to offer sharing it) and my recent personal bests. Each keeps a copy on the
// phone so Today works without signal. Reads go through RLS (a client sees only their own rows).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RECENT_PR_DAYS, awardRecords, recentPrs, withoutBlocked, type AwardResult, type PrKind } from '@caltracker/shared';
import { fetchAward } from './awards';
import { todayCacheKey } from './device-cache-keys';
import { loadLatestPosts, sharedWorkout, type FeedPost } from './community-api';
import { workoutShareCard } from './community-share';
import { supabase } from './supabase';

const DAY_MS = 24 * 60 * 60 * 1000;
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

/**
 * My last finished workout, when it can be shared now: the server has its award (so the database can build the card)
 * and I haven't shared it yet. Null otherwise. Throws when the server can't be reached.
 */
export async function fetchShareCandidate(userId: string): Promise<{ logId: string; finishedAt: string | null } | null> {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, status, finished_at')
    .eq('client_id', userId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`workout_logs: ${error.message}`);
  if (!data) return null;
  const [award, shared] = await Promise.all([fetchAward(data.id), sharedWorkout(data.id)]);
  if (shared || !workoutShareCard({ id: data.id, status: data.status }, award)) return null;
  return { logId: data.id, finishedAt: data.finished_at };
}

// ---- Personal bests -----------------------------------------------------------------------------------------

export type RecentPr = { exerciseId: string; name: string; kind: PrKind; valueKg: number; reps: number | null; achievedAt: string };

const isRecentPr = (v: unknown): v is RecentPr =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as RecentPr).name === 'string' &&
  typeof (v as RecentPr).valueKg === 'number' &&
  typeof (v as RecentPr).achievedAt === 'string';

export async function readCachedPrs(userId: string, workspaceId: string): Promise<RecentPr[] | null> {
  const v = await readJson(key(`prs.${workspaceId}`, userId));
  if (!Array.isArray(v) || !v.every(isRecentPr)) return null;
  // Offline for days: a saved PR that is no longer from the last week drops off.
  const from = Date.now() - RECENT_PR_DAYS * DAY_MS;
  return v.filter((p) => Date.parse(p.achievedAt) >= from);
}

/**
 * My personal bests from the last 7 days, from the awards the server stored (shared recentPrs picks them), with the
 * exercises' names. Throws when the server can't be reached.
 */
export async function fetchRecentPrs(userId: string, workspaceId: string, now: Date = new Date()): Promise<RecentPr[]> {
  // Awards are written after the workout, so a week and a day back covers every PR achieved in the last 7 days.
  const since = new Date(now.getTime() - 8 * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from('awards')
    .select('result')
    .eq('client_id', userId)
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`awards: ${error.message}`);
  const prs = recentPrs(awardRecords(data.map((a) => (a.result as unknown as AwardResult | null) ?? null)), now);
  const ids = [...new Set(prs.map((p) => p.exerciseId))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const ex = await supabase.from('exercises').select('id, name').in('id', ids);
    for (const e of ex.data ?? []) names.set(e.id, e.name);
  }
  const out = prs.map((p) => ({
    exerciseId: p.exerciseId,
    name: names.get(p.exerciseId) ?? 'Exercise',
    kind: p.kind,
    valueKg: p.valueKg,
    reps: p.reps,
    achievedAt: p.achievedAt,
  }));
  writeJson(key(`prs.${workspaceId}`, userId), out);
  return out;
}
