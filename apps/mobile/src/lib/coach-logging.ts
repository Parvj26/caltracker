// Single active logger, phone side (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md).
// Kept apart from the logging screens on purpose: the screens only call useCoachLogging and render
// CoachLoggingBanner (components/log/coach-logging-banner.tsx).
//
// When the coach logs a workout from the website, workout_logs.logged_by is the coach and the server refuses the
// phone's saves for it (loggedByOther). The phone learns it two ways:
//   * instantly, from a save's answer: log-sync adopts the coach's copy and use-active-log sets heldByOther;
//   * from Realtime: the log's row is published (20261106003000_workout_logs_realtime; RLS lets a client hear only
//     their own rows), so a take over, hand back or finish elsewhere arrives at once;
//   * by asking workout_log_logger when the workout opens and when the app comes back to the foreground, and once a
//     minute while the Realtime channel is not connected.
// When the server and the phone disagree (needsServerCopy) the phone takes the server's copy (refreshFromServer),
// so a workout the coach took over, handed back or finished never stays stuck open on the phone.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { LogStatus } from '@caltracker/shared';
import { needsServerCopy, parseLoggerState, type LoggerState } from './active-log-logic';
import { supabase } from './supabase';
import { useActiveLog } from './use-active-log';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How often an open workout asks whether the coach took it over while Realtime is not connected. */
export const CHECK_EVERY_MS = 60_000;

/** Who holds one of the client's logs, or null when unknown (offline, not uploaded yet, not theirs). */
export async function fetchLoggerState(logId: string): Promise<LoggerState | null> {
  if (!UUID.test(logId)) return null;
  const { data, error } = await supabase.rpc('workout_log_logger', { p_log_id: logId });
  if (error) return null;
  return parseLoggerState(data);
}

/** "Continue on my phone": takes the log back from a coach who stopped. False when the server said no. */
export async function reclaimLog(logId: string): Promise<boolean> {
  const { error } = await supabase.rpc('reclaim_workout_log', { p_log_id: logId });
  return !error;
}

export type CoachLogging = {
  /** The coach logs (or logged) this workout. */
  byCoach: boolean;
  status: LogStatus | null;
  /** The coach stopped (20 min without activity) or left: the client may take it back. */
  canReclaim: boolean;
  lastActivityAt: string | null;
  reclaim: () => Promise<boolean>;
  reclaiming: boolean;
};

/**
 * Whether the coach logs this workout. `watch` (an open workout): checks on open, on return to the app and every
 * CHECK_EVERY_MS; otherwise (a finished workout's summary) once. Never throws: without signal the client keeps
 * logging and the server settles it.
 */
export function useCoachLogging(logId: string | undefined, watch = true): CoachLogging {
  const active = useActiveLog();
  const [server, setServer] = useState<LoggerState | null>(null);
  const [reclaiming, setReclaiming] = useState(false);
  const local = active.log && active.log.id === logId ? { status: active.log.status, heldByOther: active.heldByOther } : null;
  const localRef = useRef(local);
  localRef.current = local;
  const { refreshFromServer } = active;

  const check = useCallback(async () => {
    if (!logId) return;
    const s = await fetchLoggerState(logId).catch(() => null);
    setServer((prev) =>
      prev && s && prev.status === s.status && prev.heldByOther === s.heldByOther && prev.canReclaim === s.canReclaim ? prev : s,
    );
    if (needsServerCopy(s, localRef.current)) await refreshFromServer().catch(() => undefined);
  }, [logId, refreshFromServer]);

  useEffect(() => {
    void check();
    if (!watch || !logId) return;
    let live = false;
    let me: string | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      me = data.session?.user.id ?? null;
    });
    // Every save of the log updates its row; only a change of who logs it, or of its status, needs a check.
    const channel = supabase
      .channel(`coach-logging-${logId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workout_logs', filter: `id=eq.${logId}` }, (payload) => {
        const row = payload.new as { logged_by?: string | null; status?: string };
        if (row.logged_by !== me || row.status !== 'in_progress' || localRef.current?.heldByOther) void check();
      })
      .subscribe((status) => {
        live = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
      });
    const timer = setInterval(() => {
      if (!live) void check();
    }, CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [check, watch, logId]);

  const reclaim = useCallback(async () => {
    if (!logId) return false;
    setReclaiming(true);
    try {
      const ok = await reclaimLog(logId);
      if (ok) await refreshFromServer();
      await check();
      return ok;
    } finally {
      setReclaiming(false);
    }
  }, [logId, refreshFromServer, check]);

  // A save's answer (heldByOther) is the instant signal; the server check covers the rest.
  return {
    byCoach: (local?.heldByOther ?? false) || (server?.heldByOther ?? false),
    status: server?.status ?? local?.status ?? null,
    canReclaim: server?.canReclaim ?? false,
    lastActivityAt: server?.lastActivityAt ?? null,
    reclaim,
    reclaiming,
  };
}
