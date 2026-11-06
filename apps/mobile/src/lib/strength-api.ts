// Reads the client's finished workouts and works out each lift's estimated-1RM series, keeping a copy on the phone
// so the Progress tab opens with no signal.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOG_TREE_SELECT, logRowToDoc, strengthExercises, strengthSeries, type LogTreeRow } from '@caltracker/shared';
import { parseStrengthCache, strengthCacheKey, type StrengthData } from './strength-logic';
import { supabase } from './supabase';

/** The most recent finished workouts read for the charts. */
const LOG_LIMIT = 300;

export async function readCachedStrength(userId: string): Promise<StrengthData | null> {
  try {
    return parseStrengthCache(await AsyncStorage.getItem(strengthCacheKey(userId)));
  } catch {
    return null;
  }
}

/** Reads the series from the server and saves it. Throws when the server can't be reached. */
export async function fetchStrength(userId: string): Promise<StrengthData> {
  const { data: rows, error } = await supabase
    .from('workout_logs')
    .select(LOG_TREE_SELECT)
    .eq('client_id', userId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LOG_LIMIT);
  if (error) throw new Error(`workout_logs: ${error.message}`);
  // Built by concatenation, so supabase-js cannot infer the shape; LogTreeRow describes it.
  const logs = (rows as unknown as LogTreeRow[]).map(logRowToDoc);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const data: StrengthData = {
    exercises: strengthExercises(logs).map((e) => ({ ...e, points: strengthSeries(logs, e.exerciseId, timeZone) })),
  };
  try {
    await AsyncStorage.setItem(strengthCacheKey(userId), JSON.stringify(data));
  } catch {
    // the copy on the phone is a convenience
  }
  return data;
}
