import { useCallback, useEffect } from 'react';
import type { TaskName } from '@caltracker/shared';
import { getTaskTracker } from './client';

/**
 * Starts `task` when the screen mounts (or when `active` turns true) and counts it as abandoned if the
 * screen goes away before `complete()` is called.
 */
export function useAnalyticsTask(task: TaskName, active = true): (extra?: { sets_logged?: number; variant?: string }) => void {
  useEffect(() => {
    if (!active) return;
    const tracker = getTaskTracker();
    tracker.start(task);
    return () => tracker.abandon(task);
  }, [task, active]);
  return useCallback((extra) => getTaskTracker().complete(task, extra), [task]);
}
