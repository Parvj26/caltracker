/**
 * When to re-render a page that listens for live changes (see components/live-refresh.tsx). Pure, so it can be tested
 * without a browser: the caller feeds it changes, channel statuses and visibility, and it calls `refresh`.
 *
 * - Changes are debounced (`delayMs`, 500 ms by default): a client ticking off several sets quickly costs one
 *   re-render. A steady stream still refreshes at least every `maxWaitMs`.
 * - Nothing is refreshed while the tab is hidden; the page is marked stale and refreshes once it is visible again.
 * - Nothing is refreshed while paused (`isPaused`, e.g. a dialog is open: a re-render could close a native picker in
 *   it, or move what the coach is reading); the page refreshes once on `resume()` if anything changed meanwhile.
 * - After the channel drops (error, timeout, closed) and joins again, the page refreshes once, because changes made
 *   while disconnected were never sent.
 * - The first join refreshes only when the server render is older than `firstJoinGraceMs` (1 s): a change made
 *   between the render and the join was never sent either. A quick join right after the render does not refresh.
 */
export type RefreshScheduler = {
  /** A matching row changed. */
  change(): void;
  /** The tab's visibility changed (call on `visibilitychange`). */
  visibility(): void;
  /** Whatever paused refreshes has ended (e.g. a dialog closed): refresh now if something changed meanwhile. */
  resume(): void;
  /** The Realtime channel reported a status (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED). */
  status(status: string): void;
  /** Stops for good (on unmount): clears the timer and ignores anything after. */
  dispose(): void;
};

export type RefreshSchedulerOptions = {
  refresh: () => void;
  isVisible: () => boolean;
  /** True while refreshes should wait (e.g. a dialog is open). Default: never. */
  isPaused?: () => boolean;
  delayMs?: number | undefined;
  maxWaitMs?: number | undefined;
  /** When the server rendered the page (ms since epoch); omit to never refresh on the first join. */
  renderedAt?: number | undefined;
  firstJoinGraceMs?: number | undefined;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export const LIVE_REFRESH_DELAY_MS = 500;
export const LIVE_REFRESH_MAX_WAIT_MS = 2000;
export const LIVE_REFRESH_FIRST_JOIN_GRACE_MS = 1000;

const DROPPED = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

export function createRefreshScheduler({
  refresh,
  isVisible,
  isPaused = () => false,
  delayMs = LIVE_REFRESH_DELAY_MS,
  maxWaitMs = LIVE_REFRESH_MAX_WAIT_MS,
  renderedAt,
  firstJoinGraceMs = LIVE_REFRESH_FIRST_JOIN_GRACE_MS,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: RefreshSchedulerOptions): RefreshScheduler {
  let timer: unknown = null;
  let firstChangeAt = 0;
  let stale = false;
  let dropped = false;
  let joined = false;
  let disposed = false;

  // Visible and not paused.
  const canRefresh = () => isVisible() && !isPaused();

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const fire = () => {
    timer = null;
    if (disposed) return;
    if (!canRefresh()) {
      stale = true;
      return;
    }
    stale = false;
    refresh();
  };

  const change = () => {
    if (disposed) return;
    if (!canRefresh()) {
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

  const catchUp = () => {
    if (disposed || !canRefresh() || !stale) return;
    cancel();
    fire();
  };

  return {
    change,
    visibility: catchUp,
    resume: catchUp,
    status(status) {
      if (disposed) return;
      if (DROPPED.has(status)) {
        dropped = true;
      } else if (status === 'SUBSCRIBED') {
        const first = !joined;
        joined = true;
        if (dropped || (first && renderedAt !== undefined && now() - renderedAt > firstJoinGraceMs)) {
          dropped = false;
          change();
        }
      }
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}

/** How long to wait before building a new channel after the old one closed: 1 s, 2 s, 4 s … up to 30 s. */
export function rejoinDelayMs(failures: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failures), 30_000);
}

/**
 * The time a server component is rendering, for LiveRefresh's `renderedAt`. A server component renders once per
 * request, so reading the clock there is intended (React's purity rule is about client re-renders).
 */
export function renderTime(): number {
  return Date.now();
}
