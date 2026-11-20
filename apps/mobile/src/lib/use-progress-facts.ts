// The one place the app's screens get the streak, personal bests, stickers and "this week" from (shared
// progressFacts), so Today, Progress, Consistency and the Zoo book always say the same. While the latest workout is
// still uploading or being awarded it says so (the screens show "Updating…") and asks the server again until the
// award is in.
import { useEffect, useMemo, useRef, useState } from 'react';
import { localToday, progressFacts, type ProgressFacts } from '@caltracker/shared';
import { deviceZone } from './progress-hub-api';
import { updatingRetryDelay } from './progress-hub-logic';
import { useSession } from './session';
import { useActiveLog } from './use-active-log';
import { useAlbum, useHub } from './use-progress-data';
import { useUnits } from './use-units';

export function useProgressFacts(refreshKey: number) {
  const [retry, setRetry] = useState(0);
  // When the facts were last worked out: the "is it still updating" check needs the clock.
  const [clock, setClock] = useState(() => Date.now());
  const hub = useHub(refreshKey + retry);
  const album = useAlbum(refreshKey + retry);
  const { log, pending } = useActiveLog();
  const userId = useSession().session?.user.id ?? null;
  const units = useUnits() ?? 'lb';
  const today = localToday();
  const uploading = log?.status === 'completed' || pending.length > 0;
  const facts: ProgressFacts = useMemo(
    () =>
      progressFacts({
        hub: hub.data,
        album: album.data ? { stickers: album.data.awards, stats: album.data.stats } : null,
        uploading,
        userId,
        today,
        timeZone: deviceZone(),
        units,
        nowMs: clock,
      }),
    [hub.data, album.data, uploading, userId, today, units, clock],
  );

  // Still updating: ask again after a short wait (longer each time), until the award is in.
  const attempt = useRef(0);
  useEffect(() => {
    if (!facts.updating) {
      attempt.current = 0;
      return;
    }
    const t = setTimeout(() => {
      setClock(Date.now());
      setRetry((r) => r + 1);
    }, updatingRetryDelay(attempt.current++));
    return () => clearTimeout(t);
  }, [facts.updating, retry]);

  return { facts, hub, album };
}
