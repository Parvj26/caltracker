// Push notifications for the signed-in client: keeps this iPhone registered, opens tapped pushes and keeps the
// app-icon badge in step with unread coach messages and comment notifications. Mounted in the signed-in (app)
// layout, inside the messages and community providers it reads the unread counts from.
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { isEnabled, type PushPrefs } from '@caltracker/shared';
import { revealedLogIds } from './coach-reveal';
import { setStillTrainingEnabled } from './log-notifications';
import { loadPrefs, savePrefs } from './notification-prefs';
import type { PrefsSource } from './notification-settings-logic';
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
  /** The client's notification settings; null until loaded (server, else this phone's copy, else defaults). */
  prefs: PushPrefs | null;
  /** Where prefs came from; they can be changed only when 'server'. */
  prefsSource: PrefsSource;
  /** Saves new settings: shown at once, put back (and the error rethrown) when saving fails. */
  updatePrefs: (next: PushPrefs) => Promise<void>;
};

const Ctx = createContext<PushState | null>(null);

export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [prefsSource, setPrefsSource] = useState<PrefsSource>('loading');
  const prefsSourceRef = useRef<PrefsSource>('loading');
  const prefsRef = useRef<PushPrefs | null>(null);
  const applyPrefs = useCallback((p: PushPrefs | null) => {
    prefsRef.current = p;
    setPrefs(p);
    setStillTrainingEnabled(isEnabled(p, 'still_training'));
  }, []);

  // Settings follow the account: load on sign-in, and again when the app comes back (changed on another device).
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const load = () =>
      void loadPrefs(userId).then(({ prefs: p, offline }) => {
        if (!active) return;
        // Offline after a good load: keep what is shown (and editable).
        if (offline && prefsSourceRef.current === 'server') return;
        applyPrefs(p);
        prefsSourceRef.current = offline ? 'offline' : 'server';
        setPrefsSource(prefsSourceRef.current);
      });
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => {
      active = false;
      sub.remove();
      applyPrefs(null);
      prefsSourceRef.current = 'loading';
      setPrefsSource('loading');
    };
  }, [userId, applyPrefs]);

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
  const badgeRef = useRef(badge);
  badgeRef.current = badge;
  useEffect(() => {
    if (userId) setBadge(badge);
  }, [userId, badge]);
  // A push may have changed the icon's badge while the app was away: put the app's count back on return.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setBadge(badgeRef.current));
    return () => sub.remove();
  }, [userId]);

  const requestPermission = useCallback(async () => {
    const granted = await requestPushPermission();
    refreshPermission();
    if (granted) await registerDevice();
    return granted;
  }, [refreshPermission]);

  const updatePrefs = useCallback(
    async (next: PushPrefs) => {
      if (!userId) return;
      if (prefsSourceRef.current !== 'server') throw new Error('You’re offline. You can change these when you’re back online.');
      const before = prefsRef.current;
      applyPrefs(next);
      try {
        await savePrefs(userId, next);
      } catch (e) {
        if (prefsRef.current === next) applyPrefs(before);
        throw e;
      }
    },
    [userId, applyPrefs],
  );

  const value = useMemo<PushState>(
    () => ({ permission, requestPermission, refreshPermission, prefs, prefsSource, updatePrefs }),
    [permission, requestPermission, refreshPermission, prefs, prefsSource, updatePrefs],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePush(): PushState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePush must be used inside PushProvider');
  return v;
}
