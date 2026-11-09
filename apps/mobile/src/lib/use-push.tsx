// Push notifications for the signed-in client: keeps this iPhone registered, opens tapped pushes and keeps the
// app-icon badge in step with unread coach messages and comment notifications. Mounted in the signed-in (app)
// layout, inside the messages and community providers it reads the unread counts from.
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { revealedLogIds } from './coach-reveal';
import { onPushTapped, onTokenChanged, osPermission, registerDevice, requestPushPermission, setBadge, type PushPermission } from './push';
import { badgeTotal, tapTarget, unreadCommentCount } from './push-logic';
import { useSession } from './session';
import { useCommunity } from './use-community';
import { useUnreadCount } from './use-messages';

type PushState = {
  /** What iOS says for this app; null until known. */
  permission: PushPermission | null;
  /** Asks iOS (the system alert shows once) and registers this iPhone when allowed. True when allowed. */
  requestPermission: () => Promise<boolean>;
  /** Reads the permission again (e.g. back from iPhone Settings). */
  refreshPermission: () => void;
};

const Ctx = createContext<PushState | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [permission, setPermission] = useState<PushPermission | null>(null);

  const refreshPermission = useCallback(() => {
    void osPermission().then(setPermission);
  }, []);

  // Register on sign-in and whenever the app comes back (the token can change; permission may have been given in
  // iPhone Settings meanwhile).
  useEffect(() => {
    if (!userId) return;
    const sync = () => {
      refreshPermission();
      void registerDevice();
    };
    sync();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    const stopToken = onTokenChanged();
    return () => {
      sub.remove();
      stopToken();
    };
  }, [userId, refreshPermission]);

  useEffect(() => {
    if (!userId) return;
    return onPushTapped((data) => {
      void revealedLogIds(userId).then((ids) => {
        const target = tapTarget(data, new Set(ids));
        // Only routes isPushRoute allows (or the reveal of one) reach here: tapTarget checks.
        if (target) router.push(target);
      });
    });
  }, [userId, router]);

  const unreadMessages = useUnreadCount();
  const { rows } = useCommunity();
  const badge = badgeTotal(unreadMessages, unreadCommentCount(rows));
  useEffect(() => {
    if (userId) setBadge(badge);
  }, [userId, badge]);

  const requestPermission = useCallback(async () => {
    const granted = await requestPushPermission();
    refreshPermission();
    if (granted) await registerDevice();
    return granted;
  }, [refreshPermission]);

  const value = useMemo<PushState>(
    () => ({ permission, requestPermission, refreshPermission }),
    [permission, requestPermission, refreshPermission],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePush(): PushState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePush must be used inside PushProvider');
  return v;
}
