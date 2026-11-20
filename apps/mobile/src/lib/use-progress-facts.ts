// The one place the app's screens get the streak, personal bests, stickers and "this week" from (shared
// progressFacts), so Today, Progress, Consistency and the Zoo book always say the same. While the latest workout is
// still uploading or being awarded it says so (the screens show "Updating…"). Only the screen in view keeps asking,
// and only the award rows (a light read): once the award is in, the training data and sticker book are read once
// more. Offline it shows the saved numbers and asks nothing; after AWARD_SETTLE_MS it stops asking.
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { awaitingLogIds, localToday, progressFacts, type ProgressFacts } from '@caltracker/shared';
import { deviceZone, fetchAwardedLogIds } from './progress-hub-api';
import { updatingRetryDelay } from './progress-hub-logic';
import { useSession } from './session';
import { useActiveLog } from './use-active-log';
import { useAlbum, useHub } from './use-progress-data';
import { useUnits } from './use-units';

export function useProgressFacts(refreshKey: number) {
  // Bumped when the award has arrived (or an upload finished): the training data and book are read again once.
  const [reload, setReload] = useState(0);
  const hub = useHub(refreshKey + reload);
  const album = useAlbum(refreshKey + reload);
  const { log, pending } = useActiveLog();
  const { session, workspace } = useSession();
  const userId = session?.user.id ?? null;
  const workspaceId = workspace?.workspaceId ?? null;
  const units = useUnits() ?? 'lb';
  const focused = useIsFocused();
  const today = localToday();
  const uploading = log?.status === 'completed' || pending.length > 0;
  const offline = hub.status === 'offline' || album.status === 'offline';
  // When the facts were last worked out: the "is it still waiting for its award" check needs the clock.
  const [clock, setClock] = useState(() => Date.now());

  const facts: ProgressFacts = useMemo(
    () =>
      progressFacts({
        hub: hub.data,
        album: album.data ? { stickers: album.data.awards, stats: album.data.stats } : null,
        uploading,
        offline,
        userId,
        today,
        timeZone: deviceZone(),
        units,
        nowMs: clock,
      }),
    [hub.data, album.data, uploading, offline, userId, today, units, clock],
  );

  // An upload just finished: read the training data again, so the new workout (and whether it is awarded) shows.
  const wasUploading = useRef(uploading);
  useEffect(() => {
    if (wasUploading.current && !uploading) setReload((r) => r + 1);
    wasUploading.current = uploading;
  }, [uploading]);

  // Waiting for an award: on the screen in view, and online, ask for just those award rows, waiting longer each time.
  const waitingFor = useMemo(() => (hub.data && !offline ? awaitingLogIds(hub.data.finished, clock) : []), [hub.data, offline, clock]);
  const key = waitingFor.join(',');
  const attempt = useRef(0);
  useEffect(() => {
    if (!focused || key === '' || !userId || !workspaceId) return;
    let alive = true;
    const t = setTimeout(() => {
      void fetchAwardedLogIds(userId, workspaceId, key.split(','))
        .then((awarded) => {
          if (!alive) return;
          if (awarded.size > 0) {
            attempt.current = 0;
            setReload((r) => r + 1);
          } else attempt.current += 1;
        })
        .catch(() => {
          if (alive) attempt.current += 1;
        })
        .finally(() => {
          if (alive) setClock(Date.now()); // runs this again (or stops once the wait is over)
        });
    }, updatingRetryDelay(attempt.current));
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [focused, key, userId, workspaceId, clock]);

  return { facts, hub, album };
}
