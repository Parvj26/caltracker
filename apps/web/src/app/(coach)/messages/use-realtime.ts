'use client';

import { useEffect, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@caltracker/shared';
import { createBrowserSupabase } from '@/lib/supabase/client';

/** One browser Supabase client per component. */
export function useBrowserSupabase(): SupabaseClient<Database> {
  const [client] = useState(createBrowserSupabase);
  return client;
}

/** Calls `onWake` when the tab becomes visible or the window gets focus (Realtime may have dropped meanwhile). */
export function useOnWake(onWake: () => void): void {
  const ref = useRef(onWake);
  useEffect(() => {
    ref.current = onWake;
  });
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === 'visible') ref.current();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);
}

export type ChangeSpec = { table: 'messages' | 'conversation_reads'; filter: string };

/** The few Supabase client parts the subscription needs (so a test can stand in for the real client). */
type RealtimeClient = Pick<SupabaseClient<Database>, 'channel' | 'removeChannel'> & {
  realtime: Pick<SupabaseClient<Database>['realtime'], 'setAuth'>;
};

/**
 * Joins a Realtime channel for the given tables/filters and returns the function that leaves it. Every call uses its
 * own unique topic: the browser client is shared, and a channel that is still leaving (a quick remount, React
 * StrictMode in development) would otherwise be handed back by name, the new subscribe would do nothing, and the
 * pending removal would then kill the live updates for good.
 *
 * The coach's token is loaded into Realtime (`realtime.setAuth()`) before the join. Otherwise the first join can go
 * out with only the anon key, Realtime then checks every change as anon, RLS hides every message, and nothing
 * arrives even though the channel says it is subscribed. (Same as LiveRefresh.)
 */
export function subscribeChanges(
  supabase: RealtimeClient,
  channelName: string,
  specs: ChangeSpec[],
  handlers: { onChange: (table: ChangeSpec['table'], row: Record<string, unknown>) => void; onReady?: (() => void) | undefined },
): () => void {
  let channel = supabase.channel(`${channelName}:${crypto.randomUUID()}`);
  for (const spec of specs) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: spec.table, filter: spec.filter },
      (payload) => handlers.onChange(spec.table, payload.new as Record<string, unknown>),
    );
  }
  let active = true;
  void (async () => {
    // No argument: takes the session's token now and keeps refreshing it afterwards.
    await supabase.realtime.setAuth().catch(() => undefined);
    if (!active) return;
    channel.subscribe((status) => {
      if (active && status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) handlers.onReady?.();
    });
  })();
  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}

/**
 * Subscribes to Postgres changes (RLS applies) on the given tables/filters. `onChange` gets each changed row.
 * `onReady` runs each time the channel (re)joins, so a caller can refetch what it missed while disconnected.
 */
export function useChanges(
  supabase: SupabaseClient<Database>,
  channelName: string,
  specs: ChangeSpec[],
  handlers: { onChange: (table: ChangeSpec['table'], row: Record<string, unknown>) => void; onReady?: () => void },
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  const key = JSON.stringify(specs);
  useEffect(
    () =>
      subscribeChanges(supabase, channelName, JSON.parse(key) as ChangeSpec[], {
        onChange: (table, row) => ref.current.onChange(table, row),
        onReady: () => ref.current.onReady?.(),
      }),
    [supabase, channelName, key],
  );
}
