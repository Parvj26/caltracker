import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { syncTimeZone } from './awards';
import { claimWorkspace, currentWorkspace, removedFrom, type ClaimedWorkspace } from './claim';
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

  // Checks can overlap (sign-in, "Check again", returning to the app): only the latest one's answer is applied.
  const latest = useRef(0);

  /** claim: join an invited coach if there is none (sign-in, "Check again"). Otherwise only read the current link. */
  const runCheck = useCallback(async (id: string, mode: 'claim' | 'read') => {
    const ticket = ++latest.current;
    try {
      const workspace = mode === 'claim' ? await claimWorkspace() : await currentWorkspace();
      const removed = workspace ? null : await removedFrom();
      if (ticket !== latest.current) return;
      setClaimError(null);
      setClaimed({ userId: id, workspace, removedFrom: removed });
    } catch {
      if (ticket !== latest.current) return;
      setClaimError('Could not check your invite. Try again.');
      // A failed check (often just no signal) never disconnects a client who was connected.
      setClaimed((prev) => (prev?.userId === id ? prev : { userId: id, workspace: null, removedFrom: null }));
    }
  }, []);
  const runClaim = useCallback((id: string) => runCheck(id, 'claim'), [runCheck]);

  // Runs once per signed-in user (also after a deep-link sign-in).
  useEffect(() => {
    if (userId) {
      void runClaim(userId);
      // The server counts weeks in the client's own time zone: keep the profile's equal to the phone's.
      void syncTimeZone(userId);
    } else setClaimed(null);
  }, [userId, runClaim]);

  const recheck = useCallback(async () => {
    if (userId) await runClaim(userId);
  }, [userId, runClaim]);

  // Re-read the coach link (and the phone's time zone) whenever the app comes back to the foreground, so a client
  // the coach removed sees it without signing out. Read only: it never joins a coach. Access itself is enforced by the database either way.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void runCheck(userId, 'read');
        // The phone may have travelled to another time zone while it was in the background.
        void syncTimeZone(userId);
      }
    });
    return () => sub.remove();
  }, [userId, runCheck]);

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
