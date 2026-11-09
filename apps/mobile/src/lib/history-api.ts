// Reads for the History screen: the client's finished workouts (newest first), which of them set a personal best
// (from the awards the server stored) and the streak, with a copy on the phone so History opens without signal.
// RLS limits every read to the signed-in client's own rows.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { awardHasPrs, awardPrEvents, liveStreak, localToday, startOfWeek, type PrEvent } from '@caltracker/shared';
import { todayCacheKey } from './device-cache-keys';
import { supabase } from './supabase';
import {
  HISTORY_LOG_SELECT,
  historyLogFromRow,
  parseHistoryCache,
  type HistoryData,
  type HistoryLog,
  type HistoryLogRow,
} from './workout-history';

/** The most recent finished workouts listed. */
const LOG_LIMIT = 100;

// Under the Today prefix, so Sign out forgets it (device-cache-keys).
const key = (userId: string, workspaceId: string) => todayCacheKey(`history.${workspaceId}`, userId);

export async function readCachedHistory(userId: string, workspaceId: string): Promise<HistoryData | null> {
  try {
    return parseHistoryCache(await AsyncStorage.getItem(key(userId, workspaceId)));
  } catch {
    return null;
  }
}

/** Reads History from the server and saves it. Throws when the server can't be reached. */
export async function fetchHistory(userId: string, workspaceId: string): Promise<HistoryData> {
  const { data: rows, error } = await supabase
    .from('workout_logs')
    .select(HISTORY_LOG_SELECT)
    .eq('client_id', userId)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LOG_LIMIT);
  if (error) throw new Error(`workout_logs: ${error.message}`);
  // Built by concatenation, so supabase-js cannot infer the shape; HistoryLogRow describes it.
  const logRows = rows as unknown as HistoryLogRow[];
  const ids = logRows.map((r) => r.id);

  const [awards, stats] = await Promise.all([
    ids.length > 0
      ? supabase.from('awards').select('log_id, result').eq('client_id', userId).in('log_id', ids)
      : Promise.resolve({ data: [] as Array<{ log_id: string; result: unknown }>, error: null }),
    supabase
      .from('client_stats')
      .select('streak, streak_week')
      .eq('client_id', userId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);
  if (awards.error) throw new Error(`awards: ${awards.error.message}`);
  const prLogs = new Set<string>();
  const prs: PrEvent[] = [];
  for (const a of awards.data ?? []) {
    if (awardHasPrs(a.result)) prLogs.add(a.log_id);
    prs.push(...awardPrEvents(userId, a.result));
  }
  // The streak only decorates the card: an unreadable one is left out.
  const s = stats.data;
  const streak = s ? liveStreak(s.streak, s.streak_week, startOfWeek(localToday())) : 0;

  const logs = logRows
    .map((row) => historyLogFromRow(row, userId, prLogs))
    .filter((l): l is HistoryLog => l !== null);
  const out: HistoryData = { logs, prs, streak };
  try {
    await AsyncStorage.setItem(key(userId, workspaceId), JSON.stringify(out));
  } catch {
    // the copy on the phone is a convenience
  }
  return out;
}
