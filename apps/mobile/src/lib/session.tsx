import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { claimWorkspace, removedFrom, type ClaimedWorkspace } from './claim';
import { supabase } from './supabase';

type SessionState = {
  /** True until the stored session has been read, and (when signed in) the first claim finished. */
  loading: boolean;
  session: Session | null;
  workspace: ClaimedWorkspace | null;
  /** Set when there is no coach because one removed this client: that coach's business name. */
  removedFromWorkspace: string | null;
  claimError: string | null;
  /** Re-runs claimWorkspace(), e.g. after the coach sent an invite. */
  recheck: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [claimed, setClaimed] = useState<{
    userId: string;
    workspace: ClaimedWorkspace | null;
    removedFrom: string | null;
  } | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const runClaim = useCallback(async (id: string) => {
    try {
      const workspace = await claimWorkspace();
      const removed = workspace ? null : await removedFrom();
      setClaimError(null);
      setClaimed({ userId: id, workspace, removedFrom: removed });
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : 'Could not check your invite. Try again.');
      setClaimed((prev) => (prev?.userId === id ? prev : { userId: id, workspace: null, removedFrom: null }));
    }
  }, []);

  // Runs once per signed-in user (also after a deep-link sign-in).
  useEffect(() => {
    if (userId) void runClaim(userId);
    else setClaimed(null);
  }, [userId, runClaim]);

  const recheck = useCallback(async () => {
    if (userId) await runClaim(userId);
  }, [userId, runClaim]);

  // Check again whenever the app comes back to the foreground, so a client the coach removed (or invited)
  // sees the change without signing out. Access itself is enforced by the database either way.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runClaim(userId);
    });
    return () => sub.remove();
  }, [userId, runClaim]);

  const value = useMemo<SessionState>(
    () => ({
      loading: !sessionReady || (userId !== null && claimed?.userId !== userId),
      session,
      workspace: claimed?.userId === userId ? claimed.workspace : null,
      removedFromWorkspace: claimed?.userId === userId ? claimed.removedFrom : null,
      claimError,
      recheck,
    }),
    [sessionReady, session, userId, claimed, claimError, recheck],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
