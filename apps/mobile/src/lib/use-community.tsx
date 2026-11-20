import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { groupNotifications, unreadNotificationCount, type NotificationItem, type NotificationRow } from '@caltracker/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportedPostsKey } from './device-cache-keys';
import { coachIds, loadBlocked, loadNotifications, myCommunity, type CommunityInfo } from './community-api';
import { useLive } from './community-live';
import { useSession } from './session';

type CommunityState = {
  /** null while loading or when I'm not (or no longer) in the community. */
  community: CommunityInfo | null;
  /** True once the first check finished. */
  ready: boolean;
  /** True when the coach removed me from the community (I'm still their client). */
  removed: boolean;
  /** The last check failed (no signal). */
  offline: boolean;
  coaches: Set<string>;
  blocked: Set<string>;
  notifications: NotificationItem[];
  rows: NotificationRow[];
  unread: number;
  refresh: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  setBlocked: (next: Set<string>) => void;
  /** Posts I reported: hidden from my feed at once (kept on this phone; reporters can't read reports back). */
  reported: ReadonlySet<string>;
  hideReported: (postId: string) => void;
};

const parseIds = (raw: string | null): Set<string> => {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
};

const Ctx = createContext<CommunityState | null>(null);

/**
 * The client's community: which one, who the coaches are, who I blocked, and my notifications (the Community tab's
 * badge). Notifications arrive live; push notifications can later reuse the same rows and wording.
 */
export function CommunityProvider({ children }: { children: ReactNode }) {
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const [community, setCommunity] = useState<CommunityInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [coaches, setCoaches] = useState<Set<string>>(new Set());
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setReported(new Set());
    if (!userId) return;
    let alive = true;
    void AsyncStorage.getItem(reportedPostsKey(userId))
      .then((raw) => alive && setReported(parseIds(raw)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);

  const hideReported = useCallback(
    (postId: string) => {
      setReported((prev) => {
        const next = new Set(prev).add(postId);
        if (userId) void AsyncStorage.setItem(reportedPostsKey(userId), JSON.stringify([...next])).catch(() => undefined);
        return next;
      });
    },
    [userId],
  );

  const refreshNotifications = useCallback(async () => {
    try {
      setRows(await loadNotifications());
    } catch {
      // keep what we have (offline)
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setCommunity(null);
      setReady(true);
      return;
    }
    try {
      const c = await myCommunity(workspaceId);
      setOffline(false);
      // Same community: keep the same object, so screens that depend on it don't reload in a loop.
      setCommunity((prev) => (prev && c && prev.id === c.id ? prev : c));
      if (c) {
        const [co, bl] = await Promise.all([coachIds(c.id), loadBlocked()]);
        setCoaches(co);
        setBlocked(bl);
        await refreshNotifications();
      } else {
        setRows([]);
      }
    } catch {
      // offline: keep the last known state
      setOffline(true);
    } finally {
      setReady(true);
    }
  }, [workspaceId, refreshNotifications]);

  useEffect(() => {
    setReady(false);
    setCommunity(null);
    setRows([]);
    void refresh();
  }, [userId, refresh]);

  // New notifications for me arrive live (and a reload when the app returns).
  useLive(userId && community ? [{ table: 'community_notifications', filter: `recipient_id=eq.${userId}` }] : [], () => void refreshNotifications());

  const value = useMemo<CommunityState>(() => {
    const notifications = groupNotifications(rows, blocked);
    return {
      community,
      ready,
      removed: ready && !offline && workspaceId !== null && community === null,
      offline,
      coaches,
      blocked,
      notifications,
      rows,
      unread: unreadNotificationCount(notifications),
      refresh,
      refreshNotifications,
      setBlocked,
      reported,
      hideReported,
    };
  }, [community, ready, offline, workspaceId, coaches, blocked, rows, refresh, refreshNotifications, reported, hideReported]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommunity(): CommunityState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCommunity must be used inside CommunityProvider');
  return v;
}
