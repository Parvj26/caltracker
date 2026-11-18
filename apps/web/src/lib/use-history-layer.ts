'use client';

import { useCallback, useEffect, useRef } from 'react';

/** The history-state key that marks an entry as a layer's own. */
const KEY = 'ctLayer';
/** How long release() waits for the browser to finish going back before carrying on anyway. */
const RELEASE_TIMEOUT_MS = 600;

/** Open layers by id, counted so React's development double-mount doesn't push or pop twice. */
const mounted = new Map<string, number>();
/**
 * Layers whose history entry this page pushed and hasn't stepped back over yet. A `?sheet=` that arrived some other
 * way (a shared link, a reload, a sign-in redirect) is not ours: stepping back over it would leave the page.
 */
const pushed = new Set<string>();

/** Whether the current history entry shows the layer: its own state marker, or `?<param>=<id>` in the address. */
function isCurrent(id: string, param: string): boolean {
  if (typeof window === 'undefined') return false;
  const state: unknown = window.history.state;
  if (state && typeof state === 'object' && (state as Record<string, unknown>)[KEY] === id) return true;
  return new URL(window.location.href).searchParams.get(param) === id;
}

/** The current entry is the one this page pushed for the layer, so one Back removes exactly it. */
const ownsCurrent = (id: string, param: string) => pushed.has(id) && isCurrent(id, param);

function push(id: string, param: string) {
  const url = new URL(window.location.href);
  // A leftover ?sheet= (shared link, reload while open): drop it from this entry first, so going back lands on the
  // plain page.
  if (url.searchParams.has(param)) {
    url.searchParams.delete(param);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  url.searchParams.set(param, id);
  // Only our own key: Next.js's patched pushState adds its router state and keeps useSearchParams in step.
  window.history.pushState({ [KEY]: id }, '', `${url.pathname}${url.search}${url.hash}`);
  pushed.add(id);
}

export type HistoryLayerOptions = {
  /** Unique while open, e.g. `assign-<workoutId>`. Shown in the address as `?sheet=<id>`. */
  id: string;
  /** False while the layer is closed (nothing is pushed). Defaults to true: the layer is open while mounted. */
  active?: boolean;
  /**
   * The browser went Back (button, iOS swipe-back, Android back) past the layer. Close it and return nothing; or
   * return false to keep it open (unsaved changes: ask first): the entry is pushed again, so a later release() or Back
   * still goes exactly one step.
   */
  onBack: () => boolean | void;
  /** The address parameter. Defaults to `sheet`. */
  param?: string;
};

/**
 * A pop-up, sheet or full-screen editor as one step of browser history (docs/design/ui-rules.md §8 "Back and
 * swipe-back go exactly one step"). While it is open the address gains `?sheet=<id>`, so Back closes the layer and
 * leaves the page under it, instead of leaving the page.
 *
 * Call `release()` when the layer closes any other way (×, Esc, Cancel, Save): it steps back over the layer's entry and
 * resolves once the browser has done so. Await it before navigating anywhere else, or the pending Back could undo
 * that navigation.
 */
export function useHistoryLayer({ id, active = true, onBack, param = 'sheet' }: HistoryLayerOptions): { release: () => Promise<void> } {
  const onBackRef = useRef(onBack);
  const releasing = useRef<(() => void) | null>(null);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    mounted.set(id, (mounted.get(id) ?? 0) + 1);
    // A remount (development double-mount) finds its entry still there.
    if (!ownsCurrent(id, param)) push(id, param);

    const onPopState = () => {
      if (isCurrent(id, param)) return;
      pushed.delete(id);
      const done = releasing.current;
      if (done) {
        // Our own release(): nothing to ask.
        releasing.current = null;
        done();
        return;
      }
      if (onBackRef.current() === false) push(id, param);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      mounted.set(id, (mounted.get(id) ?? 1) - 1);
      // Unmounted without release() (the page took the layer away): step back over its entry, unless the same layer
      // mounts again straight away.
      setTimeout(() => {
        if ((mounted.get(id) ?? 0) > 0) return;
        mounted.delete(id);
        if (!ownsCurrent(id, param)) return;
        pushed.delete(id);
        window.history.back();
      }, 0);
    };
  }, [active, id, param]);

  const release = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (typeof window === 'undefined' || !ownsCurrent(id, param)) {
          resolve();
          return;
        }
        // Stepped back over from here on: a slow Back must never be followed by a second one from the cleanup.
        pushed.delete(id);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          releasing.current = null;
          resolve();
        };
        releasing.current = finish;
        setTimeout(finish, RELEASE_TIMEOUT_MS);
        window.history.back();
      }),
    [id, param],
  );

  return { release };
}
