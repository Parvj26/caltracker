'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { createRefreshScheduler } from '@/lib/live-refresh';
import { createBrowserSupabase } from '@/lib/supabase/client';

/** Tables the coach's pages listen to (each must be in the supabase_realtime publication, see the migrations). */
export type LiveTable = 'workout_logs';

let channelCount = 0;

/**
 * Re-renders the current page (router.refresh, so server components load fresh data) shortly after a matching row
 * changes, e.g. `<LiveRefresh table="workout_logs" filter={`workspace_id=eq.${workspaceId}`} />`. Supabase Realtime
 * applies the signed-in coach's RLS, so the filter only narrows what they may already see. Renders nothing visible;
 * `data-live` ("connecting", "live" or "offline") lets tests wait until the page is listening. Runs only in the
 * browser: on the server it is just the empty span.
 */
export function LiveRefresh({ table, filter }: { table: LiveTable; filter: string }) {
  const router = useRouter();
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    let active = true;
    const supabase = createBrowserSupabase();
    const scheduler = createRefreshScheduler({
      refresh: () => router.refresh(),
      isVisible: () => document.visibilityState === 'visible',
    });
    // A unique topic each time: the browser client is shared, and a channel still leaving after a quick remount would
    // otherwise be handed back by name and then removed under us.
    channelCount += 1;
    const topic = `live:${table}:${filter}:${channelCount}:${Math.random().toString(36).slice(2)}`;
    const onChange = () => scheduler.change();
    const channel = supabase
      .channel(topic)
      // No DELETE: the app never deletes logs from the phone (it discards them), and DELETE events skip filters.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, onChange)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, onChange);
    // Load the coach's token into Realtime before joining. Otherwise the first join can go out with only the anon key
    // (the token is fetched in the background), Realtime then checks every change as anon, RLS hides them all, and
    // nothing arrives even though the channel says it is subscribed. setAuth() with no argument keeps refreshing the
    // token from the session afterwards.
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (!active) return;
        channel.subscribe((status) => {
          if (!active) return;
          scheduler.status(status);
          setState(status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ? 'live' : 'offline');
        });
      });
    const onVisibility = () => scheduler.visibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibility);
      scheduler.dispose();
      void supabase.removeChannel(channel);
    };
  }, [router, table, filter]);

  return <span hidden data-live={state} />;
}
