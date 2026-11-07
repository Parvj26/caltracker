'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { createRefreshScheduler, rejoinDelayMs, type RefreshScheduler } from '@/lib/live-refresh';
import { createBrowserSupabase } from '@/lib/supabase/client';

/** Tables the coach's pages listen to (each must be in the supabase_realtime publication, see the migrations). */
export type LiveTable =
  | 'workout_logs'
  | 'awards'
  | 'communities'
  | 'community_posts'
  | 'community_comments'
  | 'community_likes'
  | 'community_reports';
export type LiveSource = { table: LiveTable; filter: string };

let channelCount = 0;

/**
 * Re-renders the current page (router.refresh, so server components load fresh data) shortly after a matching row
 * changes, e.g. `<LiveRefresh on={[{ table: 'workout_logs', filter: `workspace_id=eq.${id}` }]} renderedAt={Date.now()} />`.
 * Supabase Realtime applies the signed-in coach's RLS, so a filter only narrows what they may already see.
 *
 * - `renderedAt`: when the server rendered the page; a join more than 1 s later refreshes once (changes in between
 *   were never sent). A later render's new value does not resubscribe.
 * - `maxWaitMs`: the longest a steady stream of changes waits for a refresh (2 s by default; busy pages use more).
 *
 * Renders nothing visible; `data-live` ("connecting", "live" or "offline") lets tests wait until the page is
 * listening. Runs only in the browser: on the server it is just the empty span.
 */
export function LiveRefresh({ on, renderedAt, maxWaitMs }: { on: LiveSource[]; renderedAt?: number | undefined; maxWaitMs?: number | undefined }) {
  const router = useRouter();
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  // Bumped to build a new channel after the old one closed for good.
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const scheduler = useRef<RefreshScheduler | null>(null);
  const firstRender = useRef(renderedAt);
  const key = JSON.stringify(on);

  // One scheduler for the component's life, so a rebuilt channel still knows it dropped (and refreshes on rejoin).
  useEffect(() => {
    const s = createRefreshScheduler({
      refresh: () => router.refresh(),
      isVisible: () => document.visibilityState === 'visible',
      renderedAt: firstRender.current,
      maxWaitMs,
    });
    scheduler.current = s;
    const onVisibility = () => s.visibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      s.dispose();
      scheduler.current = null;
    };
  }, [router, maxWaitMs]);

  useEffect(() => {
    let active = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const sources = JSON.parse(key) as LiveSource[];
    const supabase = createBrowserSupabase();
    // A unique topic each time: the browser client is shared, and a channel still leaving after a quick remount would
    // otherwise be handed back by name and then removed under us.
    channelCount += 1;
    let channel = supabase.channel(`live:${channelCount}:${Math.random().toString(36).slice(2)}`);
    const onChange = () => scheduler.current?.change();
    for (const { table, filter } of sources) {
      // No DELETE: Realtime can't filter or check DELETE events. Deletes that matter (community posts, comments,
      // likes) bump communities.activity_at instead, which arrives as a filtered UPDATE.
      channel = channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, onChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, onChange);
    }

    // Load the coach's token into Realtime before joining. Otherwise the first join can go out with only the anon key
    // (the token is fetched in the background), Realtime then checks every change as anon, RLS hides them all, and
    // nothing arrives even though the channel says it is subscribed. With no session there is nothing to listen to.
    void (async () => {
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      if (!active) return;
      if (!data.session) {
        setState('offline');
        return;
      }
      // No argument: keeps refreshing the token from the session afterwards.
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!active) return;
      channel.subscribe((status) => {
        if (!active) return;
        scheduler.current?.status(status);
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          failures.current = 0;
          setState('live');
          return;
        }
        setState('offline');
        // Errors and timeouts rejoin by themselves; a closed channel never does, so build a new one.
        if (status === REALTIME_SUBSCRIBE_STATES.CLOSED && retry === null) {
          retry = setTimeout(() => {
            if (active) setAttempt((n) => n + 1);
          }, rejoinDelayMs(failures.current));
          failures.current += 1;
        }
      });
    })();

    return () => {
      active = false;
      if (retry !== null) clearTimeout(retry);
      void supabase.removeChannel(channel);
    };
  }, [key, attempt]);

  return <span hidden data-live={state} />;
}
