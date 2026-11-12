/** The PerformanceNavigationTiming fields the first-load breakdown reads (the browser type satisfies it). */
export type NavTiming = {
  type: string;
  redirectStart: number;
  redirectEnd: number;
  domainLookupStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  domContentLoadedEventEnd: number;
};

export const NAV_TYPES = ['navigate', 'reload', 'back_forward', 'prerender'] as const;
export type NavType = (typeof NAV_TYPES)[number] | 'other';

export type FirstLoadBreakdown = {
  /** Total time until the page was ready (domContentLoadedEventEnd). */
  ms: number;
  redirect_ms: number;
  /** Looking up the address and opening the connection (0 when the browser reused one). */
  dns_tcp_ms: number;
  /** Request sent until the first byte came back: the server (and the distance to it). */
  server_ms: number;
  download_ms: number;
  /** First byte received until the page was ready: parsing and running scripts on the device. */
  dom_ms: number;
  nav_type: NavType;
};

const SLOW_MS = 2000;

export function navType(value: unknown): NavType {
  return (NAV_TYPES as readonly unknown[]).includes(value) ? (value as NavType) : 'other';
}

/** end - start, rounded, never negative (the browser leaves timestamps it didn't record at 0). */
function span(start: number, end: number): number {
  return start > 0 && end > start ? Math.round(end - start) : 0;
}

/** Splits a first page load into where the time went: redirects, network setup, server, download and the device. */
export function firstLoadBreakdown(nav: NavTiming): FirstLoadBreakdown {
  return {
    ms: Math.max(0, Math.round(nav.domContentLoadedEventEnd)),
    // redirectStart is 0 when the page starts the timeline itself; redirects then run from 0.
    redirect_ms: nav.redirectEnd > 0 ? Math.round(nav.redirectEnd - nav.redirectStart) : 0,
    dns_tcp_ms: span(nav.domainLookupStart, nav.connectEnd),
    server_ms: span(nav.requestStart, nav.responseStart),
    download_ms: span(nav.responseStart, nav.responseEnd),
    dom_ms: span(nav.responseEnd, nav.domContentLoadedEventEnd),
    nav_type: navType(nav.type),
  };
}

/** The breakdown to report as `slow_screen`, or null when the first load was quick (or not measured). */
export function slowFirstLoad(nav: NavTiming | undefined): FirstLoadBreakdown | null {
  if (!nav) return null;
  const out = firstLoadBreakdown(nav);
  return out.ms > SLOW_MS ? out : null;
}
