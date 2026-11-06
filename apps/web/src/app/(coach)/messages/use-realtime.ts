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
  useEffect(() => {
    const parsed = JSON.parse(key) as ChangeSpec[];
    let channel = supabase.channel(channelName);
    for (const spec of parsed) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: spec.table, filter: spec.filter },
        (payload) => ref.current.onChange(spec.table, payload.new as Record<string, unknown>),
      );
    }
    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) ref.current.onReady?.();
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, channelName, key]);
}
