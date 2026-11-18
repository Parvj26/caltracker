'use client';

// "Back to …" buttons and leaving a screen go one step back in history when the page they lead to is the one just
// behind this one, so the coach gets it exactly as they left it (filters, week, scroll) and no loop of pages builds
// up. Otherwise they open that page as usual. The browser's Navigation API says what is behind (Chrome, Edge,
// Safari 26); without it the page simply opens.

type NavigationLike = {
  entries: () => { url: string | null }[];
  currentEntry: { index: number } | null;
};

type RouterLike = { back: () => void; push: (href: string) => void; replace: (href: string) => void };

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

/** Back when the entry behind matches; else opens `href` as a new entry. */
export function backOrPush(router: RouterLike, match: (url: URL) => boolean, href: string): void {
  if (previousEntryIs(match)) router.back();
  else router.push(href);
}

/** Back when the entry behind matches; else opens `href` in place of this page. */
export function backOrReplace(router: RouterLike, match: (url: URL) => boolean, href: string): void {
  if (previousEntryIs(match)) router.back();
  else router.replace(href);
}
