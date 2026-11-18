'use client';

import { useEffect, useRef } from 'react';

/** The pop-up named in the address when the page loaded (`?sheet=<id>`), or null. */
export function sheetInAddress(param = 'sheet'): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(param);
}

/** Addresses (`?param=id` at load) a page component has reopened; the others are taken off. */
const claimed = new Set<string>();

/**
 * Reopens a pop-up named in the address (docs/design/ui-rules.md §8.3 "Opened layers are restorable from the URL"):
 * a refresh or a shared link with `?sheet=<id>` opens that AdaptiveDialog again. `open` gets the id and returns true
 * when it opened something (false: not this page's, or the thing is gone). Runs once, after the page has hydrated.
 *
 * The dialog's own history step then takes the old `?sheet=` off the page's entry and puts it back on its own, so Back
 * closes the pop-up and stays on the page. A `?sheet=` nothing on the page claims is taken off the address (replaced,
 * no history step), so it doesn't linger or get copied into later links.
 */
export function useSheetOnLoad(open: (id: string) => boolean, { param = 'sheet' }: { param?: string } = {}) {
  const ran = useRef(false);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const id = sheetInAddress(param);
    if (!id) return;
    const key = `${param}=${id}`;
    if (claimed.has(key)) return;
    if (openRef.current(id)) {
      claimed.add(key);
      // Claimed for this load only (a later visit with the same address opens it again): forgotten after the other
      // components' checks below, which were all queued in this same commit.
      setTimeout(() => setTimeout(() => claimed.delete(key), 0), 0);
      return;
    }
    // Other components on the page get their turn first (their effects run in this same commit); nobody claimed it:
    // take it off.
    setTimeout(() => {
      if (claimed.has(key)) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get(param) !== id) return;
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }, 0);
  }, [param]);
}
