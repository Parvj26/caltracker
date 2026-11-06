// Reads the client's sticker book from the server and keeps a copy on the phone, so the Zoo tab opens with no signal.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { albumCacheKey, parseAlbumCache, type AlbumData } from './album-logic';
import { supabase } from './supabase';

/** The saved album for this user with this coach, or null. */
export async function readCachedAlbum(userId: string, workspaceId: string): Promise<AlbumData | null> {
  try {
    return parseAlbumCache(await AsyncStorage.getItem(albumCacheKey(userId, workspaceId)));
  } catch {
    return null;
  }
}

/**
 * Reads the album the client earned with their current coach (award rows are per workspace) and saves it. Throws when
 * the server can't be reached.
 */
export async function fetchAlbum(userId: string, workspaceId: string): Promise<AlbumData> {
  const [awards, stats] = await Promise.all([
    supabase
      .from('sticker_awards')
      .select('sticker_key, count, shiny, first_earned_at')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId),
    supabase
      .from('client_stats')
      .select('workouts, streak, streak_week, best_streak, journey_week, pr_count, lifetime_volume_kg')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);
  if (awards.error) throw new Error(`sticker_awards: ${awards.error.message}`);
  if (stats.error) throw new Error(`client_stats: ${stats.error.message}`);
  const s = stats.data;
  const data: AlbumData = {
    awards: awards.data.map((a) => ({
      key: a.sticker_key,
      count: a.count,
      shiny: a.shiny,
      firstEarnedAt: a.first_earned_at,
    })),
    stats: s
      ? {
          workouts: s.workouts,
          streak: s.streak,
          streakWeek: s.streak_week,
          bestStreak: s.best_streak,
          journeyWeek: s.journey_week,
          prCount: s.pr_count,
          lifetimeVolumeKg: Number(s.lifetime_volume_kg),
        }
      : null,
  };
  try {
    await AsyncStorage.setItem(albumCacheKey(userId, workspaceId), JSON.stringify(data));
  } catch {
    // the copy on the phone is a convenience
  }
  return data;
}
