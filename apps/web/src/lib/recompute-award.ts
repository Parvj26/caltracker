import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';

/**
 * Asks the award-workout function to work a log's personal bests, totals and streak out again after a coach
 * correction (it never touches stickers or rolls). The correction is already saved, so a failure here is logged and
 * swallowed: the hourly catch-up and the client's next workout bring the numbers right. A removed client answers
 * 403 not_a_client, which is expected and silent.
 */
export async function recomputeAward(supabase: SupabaseClient<Database>, logId: string): Promise<void> {
  try {
    const result = (await supabase.functions.invoke('award-workout', { body: { logId, recompute: true } })) as {
      error: (Error & { context?: unknown }) | null;
    };
    const error = result.error;
    if (!error) return;
    const response = error.context;
    if (response instanceof Response && response.status === 403) {
      const body = (await response.clone().json().catch(() => null)) as { hint?: string } | null;
      if (body?.hint === 'not_a_client') return;
    }
    console.error('recomputeAward failed', error.message);
  } catch (err) {
    console.error('recomputeAward failed', err instanceof Error ? err.message : err);
  }
}
