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
// While the coach holds it, every coach save (a set ticked, a number typed) changes the row too: the phone then pulls
// the coach's copy (pullCoachCopy, coach-watch.ts) and the read-only pages follow along live. A pull that fails
// (offline) is retried with backoff and on each minute tick; when Realtime (re)connects the phone checks and pulls
// at once, so a dropped connection catches up. Meanwhile `live` is false and the bar says "Reconnecting…".
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { LogStatus } from '@caltracker/shared';
import { needsServerCopy, parseLoggerState, type LoggerState } from './active-log-logic';
import { retryDelayMs, rowChangeAction, shouldPullCoachCopy } from './coach-watch';
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
  /**
   * The coach's copy shown is current: Realtime is connected (or still connecting) and the last pull worked. False
   * while catching up after the connection dropped or a pull failed.
   */
  live: boolean;
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
  const { refreshFromServer, pullCoachCopy } = active;
  const [realtime, setRealtime] = useState<'connecting' | 'up' | 'down'>('connecting');
  const [pullFailed, setPullFailed] = useState(false);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The retry runs the latest check (check and pull refer to each other).
  const checkRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const clearRetry = () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  };
  /** Pulls the coach's copy; on failure tries again later (backoff), through a check in case it changed hands. */
  const pull = useCallback(async () => {
    const ok = await pullCoachCopy();
    clearRetry();
    if (ok) {
      failures.current = 0;
      setPullFailed(false);
      return;
    }
    failures.current += 1;
    setPullFailed(true);
    retryTimer.current = setTimeout(() => void checkRef.current(), retryDelayMs(failures.current));
  }, [pullCoachCopy]);

  const check = useCallback(
    async (opts: { pull: boolean } = { pull: true }) => {
      if (!logId) return;
      const s = await fetchLoggerState(logId).catch(() => null);
      setServer((prev) =>
        prev && s && prev.status === s.status && prev.heldByOther === s.heldByOther && prev.canReclaim === s.canReclaim ? prev : s,
      );
      const wantsPull = shouldPullCoachCopy(s, localRef.current);
      if (s && !wantsPull) {
        // Not held any more (hand back, reclaim, finish): nothing left to catch up on.
        clearRetry();
        failures.current = 0;
        setPullFailed(false);
      }
      if (needsServerCopy(s, localRef.current)) await refreshFromServer().catch(() => undefined);
      else if (opts.pull && wantsPull) await pull();
    },
    [logId, refreshFromServer, pull],
  );
  checkRef.current = () => check();
  const stale = useRef(false);
  stale.current = pullFailed;

  useEffect(() => {
    void check();
    if (!watch || !logId) return;
    let live = false;
    let me: string | null = null;
    setRealtime('connecting');
    void supabase.auth.getSession().then(({ data }) => {
      me = data.session?.user.id ?? null;
    });
    // Every save of the log updates its row; only a change of who logs it, or of its status, needs a check. While
    // the coach holds it, a coach save is pulled at once, and the check then doesn't pull again (rowChangeAction).
    const channel = supabase
      .channel(`coach-logging-${logId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'workout_logs', filter: `id=eq.${logId}` }, (payload) => {
        const row = payload.new as { logged_by?: string | null; status?: string };
        const act = rowChangeAction(row, me, localRef.current?.heldByOther ?? false);
        if (act.pull) void pull();
        if (act.check) void check({ pull: !act.pull });
      })
      .subscribe((status) => {
        const was = live;
        live = status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
        if (live) {
          setRealtime('up');
          // Connected, or back after a drop: catch up on anything missed meanwhile.
          if (!was) void check();
        } else if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          setRealtime('down');
        }
      });
    const timer = setInterval(() => {
      if (!live || stale.current) void check();
    }, CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => {
      clearInterval(timer);
      clearRetry();
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [check, watch, logId, pull]);

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
    live: realtime !== 'down' && !pullFailed,
  };
}
