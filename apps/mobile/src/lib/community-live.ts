// Live updates for the Community tab through Supabase Realtime. Realtime checks every INSERT/UPDATE against my own
// RLS (so I only ever hear about my community, never about blocked members); DELETE events can't be filtered and carry
// only the row's uuid key, so any delete just triggers a reload. Changes are debounced into one reload.
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from './supabase';

const DEBOUNCE_MS = 400;
let channelCount = 0;

type Source = { table: 'community_posts' | 'community_comments' | 'community_likes' | 'community_notifications'; filter: string; deletes?: boolean };

/**
 * Calls `onChange` (debounced) when a matching row changes, once after the channel (re)joins, and when the app comes
 * back to the foreground (changes made while away were never sent). Nothing while `sources` is empty.
 */
export function useLive(sources: Source[], onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  const key = JSON.stringify(sources);

  useEffect(() => {
    const list = JSON.parse(key) as Source[];
    if (list.length === 0) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let joinedOnce = false;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => active && latest.current(), DEBOUNCE_MS);
    };
    channelCount += 1;
    let channel = supabase.channel(`community:${channelCount}:${Math.random().toString(36).slice(2)}`);
    for (const { table, filter, deletes } of list) {
      channel = channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, fire)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, fire);
      if (deletes) channel = channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, fire);
    }
    void (async () => {
      // Load my token into Realtime first; otherwise the join can go out as anon and RLS hides every change.
      await supabase.realtime.setAuth().catch(() => undefined);
      if (!active) return;
      channel.subscribe((status) => {
        if (!active || status !== REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return;
        // A rejoin after a drop: reload once, since nothing was sent while disconnected.
        if (joinedOnce) fire();
        joinedOnce = true;
      });
    })();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && fire());
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [key]);
}
