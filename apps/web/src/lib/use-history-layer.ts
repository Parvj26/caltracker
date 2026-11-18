'use client';

import { useCallback, useEffect, useRef } from 'react';
import { pushLayer, type LayerHandle } from './history-layers';

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
 * leaves the page under it, instead of leaving the page. A leftover `?sheet=` (a shared link, a reload) is taken off
 * the page's entry first, so closing never leaves the page.
 *
 * Built on the app's one history stack (lib/history-layers.ts), with the pop-ups opened by openLayer and the unsaved
 * changes guard, so they all nest and unwind in order.
 *
 * Call `release()` when the layer closes any other way (×, Esc, Cancel, Save): it steps back over the layer's entry and
 * resolves once the browser has done so. Navigations made straight after it wait for that step, so they aren't undone.
 */
export function useHistoryLayer({ id, active = true, onBack, param = 'sheet' }: HistoryLayerOptions): { release: () => Promise<void> } {
  const onBackRef = useRef(onBack);
  const layer = useRef<LayerHandle | null>(null);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    const handle = pushLayer(
      () => {
        const result = onBackRef.current();
        // Closed by Back: its entry is gone, nothing left to release.
        if (result !== false && layer.current === handle) layer.current = null;
        return result;
      },
      { address: { param, id } },
    );
    layer.current = handle;
    return () => {
      // Unmounted without release() (the page took the layer away): step back over its entry, once.
      if (layer.current === handle) layer.current = null;
      void handle.release();
    };
  }, [active, id, param]);

  const release = useCallback(() => {
    const handle = layer.current;
    layer.current = null;
    return handle ? handle.release() : Promise.resolve();
  }, []);

  return { release };
}
