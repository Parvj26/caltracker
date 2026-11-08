import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { currentScreen, track } from './analytics/client';

const SLOW_SCREEN_MS = 2000;

export type CachedLoad<T> = {
  /** Null until the saved copy or the server answered. */
  data: T | null;
  /** 'loading' before any answer; 'offline' when the server couldn't be reached (the saved copy, if any, is shown). */
  status: 'loading' | 'ready' | 'offline';
};

/**
 * One Today card's data: the copy saved on the phone first (so the card shows at once and without signal), then the
 * server's. Reloads each time the screen comes into view and when `refreshKey` changes (pull to refresh). `key`
 * names whose data it is: when it changes (another user, another community) the old data is dropped. A null key
 * means there is nothing to load yet.
 */
export function useCachedLoad<T>(
  key: string | null,
  readCache: () => Promise<T | null>,
  fetchFresh: () => Promise<T>,
  refreshKey: number,
): CachedLoad<T> {
  const [state, setState] = useState<{ key: string | null } & CachedLoad<T>>({ key, data: null, status: 'loading' });
  const latest = useRef(0);
  const fns = useRef({ readCache, fetchFresh });
  useEffect(() => {
    fns.current = { readCache, fetchFresh };
  });

  const load = useCallback(async () => {
    if (key === null) return;
    const ticket = ++latest.current;
    const startedAt = Date.now();
    let reported = false;
    // Something on screen (a saved copy or fresh data) after more than 2 s counts as a slow screen.
    const shown = () => {
      if (reported) return;
      reported = true;
      const ms = Date.now() - startedAt;
      if (ms > SLOW_SCREEN_MS) track('slow_screen', { screen: currentScreen(), ms });
    };
    const cached = await fns.current.readCache().catch(() => null);
    if (ticket !== latest.current) return;
    if (cached !== null) shown();
    if (cached !== null) setState((s) => (s.key === key && s.data !== null ? s : { key, data: cached, status: 'loading' }));
    try {
      const fresh = await fns.current.fetchFresh();
      if (ticket !== latest.current) return;
      shown();
      setState({ key, data: fresh, status: 'ready' });
    } catch {
      if (ticket !== latest.current) return;
      setState((s) => ({ key, data: s.key === key ? s.data : cached, status: 'offline' }));
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (refreshKey > 0) void load();
  }, [refreshKey, load]);

  return state.key === key ? { data: state.data, status: state.status } : { data: null, status: 'loading' };
}
