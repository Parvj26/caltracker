'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

// "Back to …" buttons and leaving a screen go one step back in history when the page they lead to is the one just
// behind this one, so the coach gets it exactly as they left it (filters, week, scroll) and no loop of pages builds
// up. Otherwise they open that page as usual. The browser's Navigation API says what is behind (Chrome, Edge,
// Safari 26); without it the page simply opens.

type NavigationLike = {
  entries: () => { url: string | null }[];
  currentEntry: { index: number } | null;
};

type RouterLike = { back: () => void; push: (href: string) => void; replace: (href: string) => void };

// Browsers without the Navigation API (iPhone and iPad before iOS 26) can't say what is behind. For them each page
// that keeps its view in the address (a list's filters, a calendar's week) remembers its last full address for this
// tab, and "Back to …" opens that, so the page still comes back as it was left.
const LAST_URL = 'caltracker:last-url:';
/** Address values that open a layer over the page, left out of a remembered address. */
export const LAYER_PARAMS = ['sheet', 'add', 'scan'] as const;

/** The address to remember: without open pop-ups (?sheet=, and the ?add= / ?scan= shortcuts that open one). */
export function rememberable(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const layer of LAYER_PARAMS) params.delete(layer);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

/** Remembers this page's full address (path + query) for this tab. */
export function rememberUrl(): void {
  try {
    window.sessionStorage.setItem(`${LAST_URL}${window.location.pathname}`, rememberable(window.location.pathname, window.location.search));
  } catch {
    // Storage blocked: "Back to …" opens the plain page.
  }
}

/** The last full address seen for `path` in this tab, else `path`'s own `href`. */
export function rememberedUrl(path: string, href: string): string {
  try {
    const kept = window.sessionStorage.getItem(`${LAST_URL}${path}`);
    return kept && kept.startsWith(path) ? kept : href;
  } catch {
    return href;
  }
}

/** Remembers the address whenever it changes (pages whose view is in the address). */
export function useRememberUrl(): void {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    rememberUrl();
  }, [pathname, search]);
}

/** The address one step back in this tab's history, or null when there is none or the browser can't say. */
export function previousEntryUrl(nav: NavigationLike | undefined): URL | null {
  const at = nav?.currentEntry?.index;
  if (!nav || at === undefined || at < 1) return null;
  const url = nav.entries()[at - 1]?.url;
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function browserNavigation(): NavigationLike | undefined {
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

/** True when the entry behind this one is on this site and passes `match`. */
export function previousEntryIs(match: (url: URL) => boolean): boolean {
  const prev = previousEntryUrl(browserNavigation());
  return prev !== null && prev.origin === window.location.origin && match(prev);
}

/** Back when the entry behind is `href`'s page; else opens it (as last seen in this tab) in place of this page. */
export function backOrReplace(router: RouterLike, href: string): void {
  const path = new URL(href, window.location.origin).pathname;
  if (previousEntryIs((url) => url.pathname === path)) router.back();
  else router.replace(rememberedUrl(path, href));
}
