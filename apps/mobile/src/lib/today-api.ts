// Server reads for the cards on the Today tab that no other screen already keeps: my first name, this week's plan and
// the community's newest posts. Each keeps a copy on the phone so Today works without signal. Reads go through RLS (a client sees only their own rows).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays, startOfWeek, withoutBlocked, type IsoDate } from '@caltracker/shared';
import { todayCacheKey } from './device-cache-keys';
import { loadLatestPosts, type FeedPost } from './community-api';
import { fetchLogsForDays, type LogForDay } from './log-api';
import { supabase } from './supabase';
import { fetchWorkoutsBetween } from './workouts-api';

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


// ---- This week ----------------------------------------------------------------------------------------------

/** This week's planned workouts (ids) and their logs, for the "This week" tile. */
export type WeekPlan = { weekStart: IsoDate; workoutIds: string[]; logs: LogForDay[] };

const isWeekPlan = (v: unknown): v is WeekPlan =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as WeekPlan).weekStart === 'string' &&
  Array.isArray((v as WeekPlan).workoutIds) &&
  Array.isArray((v as WeekPlan).logs);

/** The saved copy, only while it is still this week. */
export async function readCachedWeek(userId: string, today: IsoDate): Promise<WeekPlan | null> {
  const v = await readJson(key('week', userId));
  return isWeekPlan(v) && v.weekStart === startOfWeek(today) ? v : null;
}

/** Monday to Sunday of the phone's week. Throws when the server can't be reached. */
export async function fetchWeek(userId: string, today: IsoDate): Promise<WeekPlan> {
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const [workouts, logs] = await Promise.all([fetchWorkoutsBetween(weekStart, weekEnd), fetchLogsForDays(weekStart, weekEnd)]);
  const plan = { weekStart, workoutIds: workouts.map((w) => w.id), logs };
  writeJson(key('week', userId), plan);
  return plan;
}
