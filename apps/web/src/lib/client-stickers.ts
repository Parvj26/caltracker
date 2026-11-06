import type { SupabaseClient } from '@supabase/supabase-js';
import { liveStreak, personalBestRows, safeTimeZone, STICKERS, weekKey } from '@caltracker/shared';
import type { Database, PersonalBestRow } from '@caltracker/shared';

export const RECENT_STICKERS = 6;

export type ClientStickers = {
  streak: number;
  bestStreak: number;
  /** Stickers collected, and how many exist. */
  collected: number;
  total: number;
  recent: Array<{ key: string; name: string; shiny: boolean }>;
  bests: PersonalBestRow[];
};

/**
 * A client's streak, zoo book and personal bests in this workspace, read through the coach's own session (RLS limits
 * it to the workspace). The stored streak is as of the client's last workout; it is shown as it stands this week in
 * the client's time zone (0 once a whole week passed without a workout).
 */
export async function loadClientStickers(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  clientId: string,
  now: Date = new Date(),
): Promise<ClientStickers> {
  const [stats, profile, owned, recent, records] = await Promise.all([
    supabase.from('client_stats').select('streak, streak_week, best_streak').eq('workspace_id', workspaceId).eq('client_id', clientId).maybeSingle(),
    supabase.from('profiles').select('time_zone').eq('id', clientId).maybeSingle(),
    supabase.from('sticker_awards').select('sticker_key', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('client_id', clientId),
    supabase
      .from('sticker_awards')
      .select('sticker_key, shiny')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .order('last_earned_at', { ascending: false })
      .order('sticker_key')
      .limit(RECENT_STICKERS),
    supabase
      .from('personal_records')
      .select('exercise_id, kind, value_kg, reps, achieved_at, exercises(name)')
      .eq('workspace_id', workspaceId)
      .eq('client_id', clientId)
      .in('kind', ['heaviest', 'e1rm']),
  ]);
  if (stats.error) throw new Error(`Could not load the streak: ${stats.error.message}`);
  if (owned.error) throw new Error(`Could not load stickers: ${owned.error.message}`);
  if (recent.error) throw new Error(`Could not load stickers: ${recent.error.message}`);
  if (records.error) throw new Error(`Could not load personal bests: ${records.error.message}`);

  const names = new Map(STICKERS.map((s) => [s.key, s.name]));
  return {
    // A profile the coach cannot read (or a bad zone) falls back to UTC, as on the strength chart.
    streak: stats.data
      ? liveStreak(stats.data.streak, stats.data.streak_week, weekKey(now.toISOString(), safeTimeZone(profile.data?.time_zone)))
      : 0,
    bestStreak: stats.data?.best_streak ?? 0,
    collected: owned.count ?? 0,
    total: STICKERS.length,
    recent: recent.data.map((r) => ({ key: r.sticker_key, name: names.get(r.sticker_key) ?? r.sticker_key, shiny: r.shiny })),
    bests: personalBestRows(
      records.data.map((r) => ({
        exerciseId: r.exercise_id,
        name: r.exercises?.name ?? 'Exercise',
        kind: r.kind as 'heaviest' | 'e1rm', // the check constraint and the .in() filter above allow only these two here
        valueKg: Number(r.value_kg),
        reps: r.reps,
        achievedAt: r.achieved_at,
      })),
    ),
  };
}
