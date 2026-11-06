// Single active logger, phone side (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md).
// Kept apart from the logging screens on purpose: the screens only call useCoachLogging and render
// CoachLoggingBanner (components/log/coach-logging-banner.tsx).
//
// When the coach logs a workout from the website, workout_logs.logged_by is the coach and the server refuses the
// phone's saves for it (loggedByOther). The phone learns it two ways:
//   * instantly, from a save's answer: log-sync adopts the coach's copy and use-active-log sets heldByOther;
//   * by asking workout_log_logger when the workout opens, when the app comes back to the foreground, and at most
//     once a minute while it stays open.
// When the server and the phone disagree (needsServerCopy) the phone takes the server's copy (refreshFromServer),
// so a workout the coach took over, handed back or finished never stays stuck open on the phone.
// TODO(realtime): once PR #34 publishes workout_logs to Realtime on main, subscribe to this log's row instead of
// the one-minute check.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { LogStatus } from '@caltracker/shared';
import { needsServerCopy, parseLoggerState, type LoggerState } from './active-log-logic';
import { supabase } from './supabase';
import { useActiveLog } from './use-active-log';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The most often an open workout asks whether the coach took it over. */
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
    if (!watch) return;
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [check, watch]);

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
