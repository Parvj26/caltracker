/**
 * When to re-render a page that listens for live changes (see components/live-refresh.tsx). Pure, so it can be tested
 * without a browser: the caller feeds it changes, channel statuses and visibility, and it calls `refresh`.
 *
 * - Changes are debounced (`delayMs`, 500 ms by default): a client ticking off several sets quickly costs one
 *   re-render. A steady stream still refreshes at least every `maxWaitMs`.
 * - Nothing is refreshed while the tab is hidden; the page is marked stale and refreshes once it is visible again.
 * - After the channel drops (error, timeout, closed) and joins again, the page refreshes once, because changes made
 *   while disconnected were never sent. The first join does not refresh: the page was just rendered.
 */
export type RefreshScheduler = {
  /** A matching row changed. */
  change(): void;
  /** The tab's visibility changed (call on `visibilitychange`). */
  visibility(): void;
  /** The Realtime channel reported a status (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED). */
  status(status: string): void;
  /** Stops for good (on unmount): clears the timer and ignores anything after. */
  dispose(): void;
};

export type RefreshSchedulerOptions = {
  refresh: () => void;
  isVisible: () => boolean;
  delayMs?: number;
  maxWaitMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const LIVE_REFRESH_DELAY_MS = 500;
export const LIVE_REFRESH_MAX_WAIT_MS = 2000;

const DROPPED = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export function createRefreshScheduler({
  refresh,
  isVisible,
  delayMs = LIVE_REFRESH_DELAY_MS,
  maxWaitMs = LIVE_REFRESH_MAX_WAIT_MS,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: RefreshSchedulerOptions): RefreshScheduler {
  let timer: unknown = null;
  let firstChangeAt = 0;
  let stale = false;
  let dropped = false;
  let disposed = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const fire = () => {
    timer = null;
    if (disposed) return;
    if (!isVisible()) {
      stale = true;
      return;
    }
    stale = false;
    refresh();
  };

  const change = () => {
    if (disposed) return;
    if (!isVisible()) {
      cancel();
      stale = true;
      return;
    }
    const t = now();
    if (timer === null) firstChangeAt = t;
    cancel();
    const left = Math.max(0, firstChangeAt + maxWaitMs - t);
    timer = setTimer(fire, Math.min(delayMs, left));
  };

  return {
    change,
    visibility() {
      if (disposed || !isVisible() || !stale) return;
      cancel();
      fire();
    },
    status(status) {
      if (disposed) return;
      if (DROPPED.has(status)) {
        dropped = true;
      } else if (status === 'SUBSCRIBED' && dropped) {
        dropped = false;
        change();
      }
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
