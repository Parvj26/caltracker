// The Progress tab's data, each piece the copy saved on the phone first and then the server's (useCachedLoad), so
// every Progress screen shows its saved numbers with no signal.
import { useCallback, useState } from 'react';
import { localToday } from '@caltracker/shared';
import { fetchAlbum, readCachedAlbum } from './album-api';
import { fetchMyProgress, readCachedProgress } from './body-api';
import { fetchFoodRange, fetchHub, readCachedFoodRange, readCachedHub } from './progress-hub-api';
import { useSession } from './session';
import { useCachedLoad } from './use-cached-load';

function useIds() {
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  return { userId, workspaceId, key: userId && workspaceId ? `${userId}:${workspaceId}` : null };
}

/** Training: lifts, planned and finished workouts, program, bests. */
export function useHub(refreshKey: number) {
  const { userId, workspaceId, key } = useIds();
  return useCachedLoad(
    key,
    () => (userId && workspaceId ? readCachedHub(userId, workspaceId) : Promise.resolve(null)),
    () => fetchHub(userId!, workspaceId!, localToday()),
    refreshKey,
  );
}

/** Stickers and the stored streak, best streak and lifetime volume (the Zoo book's own copy). */
export function useAlbum(refreshKey: number) {
  const { userId, workspaceId, key } = useIds();
  return useCachedLoad(
    key,
    () => (userId && workspaceId ? readCachedAlbum(userId, workspaceId) : Promise.resolve(null)),
    () => fetchAlbum(userId!, workspaceId!),
    refreshKey,
  );
}

/** Body scans, weight entries, custom measures and the coach's goal. */
export function useBody(refreshKey: number) {
  const { userId, key } = useIds();
  return useCachedLoad(key, () => (userId ? readCachedProgress(userId) : Promise.resolve(null)), fetchMyProgress, refreshKey);
}

/** Meals over the last 4 weeks and this week, and the coach's targets. */
export function useFoodRange(refreshKey: number) {
  const { userId, workspaceId, key } = useIds();
  return useCachedLoad(
    key,
    () => (userId && workspaceId ? readCachedFoodRange(userId, workspaceId) : Promise.resolve(null)),
    () => fetchFoodRange(userId!, workspaceId!, localToday()),
    refreshKey,
  );
}

/** Pull to refresh for a Progress screen: bumps the key the loads above reload on, and shows the spinner briefly. */
export function usePullRefresh() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    // useCachedLoad reloads on the key change; the spinner only needs to show the pull was heard.
    setTimeout(() => setRefreshing(false), 600);
  }, []);
  return { refreshKey, refreshing, onRefresh };
}
