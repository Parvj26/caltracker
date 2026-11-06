// Single active logger, phone side (docs/superpowers/specs/2026-11-06-coach-session-logging-design.md).
// Kept apart from the logging screens on purpose: the screens only call useCoachLogging and render
// CoachLoggingBanner (components/log/coach-logging-banner.tsx). When the coach logs a workout from the website,
// workout_logs.logged_by is the coach and the server refuses the phone's saves for it, so the phone shows
// "Your coach is logging this session" instead of letting the client edit it.
import { useEffect, useState } from 'react';
import { isLoggedByCoach, type LogStatus } from '@caltracker/shared';
import { supabase } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How often an open workout checks whether the coach took it over. */
const CHECK_EVERY_MS = 15_000;

export type CoachLogging = { byCoach: boolean; status: LogStatus | null };

/** Who logs this log on the server. Unknown (offline, not uploaded yet) reads as the client's own. */
export async function fetchCoachLogging(logId: string): Promise<CoachLogging> {
  if (!UUID.test(logId)) return { byCoach: false, status: null };
  const { data, error } = await supabase.from('workout_logs').select('client_id, logged_by, status').eq('id', logId).maybeSingle();
  if (error || !data) return { byCoach: false, status: null };
  return { byCoach: isLoggedByCoach({ loggedBy: data.logged_by, clientId: data.client_id }), status: data.status };
}

/**
 * Whether the coach logs this workout, checked on open and then every 15 s while `watch` is true (an open workout
 * the coach may take over). Never throws: without signal the client keeps logging and the server settles it.
 */
export function useCoachLogging(logId: string | undefined, watch = true): CoachLogging {
  const [state, setState] = useState<CoachLogging>({ byCoach: false, status: null });
  useEffect(() => {
    if (!logId) return;
    let alive = true;
    const check = () => {
      fetchCoachLogging(logId)
        .then((s) => {
          // Same answer: keep the same object, so the open workout does not redraw every check.
          if (alive) setState((prev) => (prev.byCoach === s.byCoach && prev.status === s.status ? prev : s));
        })
        .catch(() => undefined);
    };
    check();
    const timer = watch ? setInterval(check, CHECK_EVERY_MS) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [logId, watch]);
  return state;
}
