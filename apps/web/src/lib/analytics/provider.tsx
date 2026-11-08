'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { scrubUrl } from '@caltracker/shared';
import { buildingProgramId, getTaskTracker, identifyPerson, initAnalytics, resetAnalytics, track, type AnalyticsPerson } from './client';
import { buildProgramLeft, navTarget, slowNavMs } from './nav-rules';

const SLOW_MS = 2000;

/** Starts analytics for a signed-in coach and feeds taps, back presses, screens and tab visibility to the task tracker. */
export function AnalyticsProvider({ person, children }: { person: AnalyticsPerson; children: React.ReactNode }) {
  const pathname = usePathname();
  const navStartedAt = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    initAnalytics();
    identifyPerson(person);
  }, [person]);

  useEffect(() => {
    const screen = scrubUrl(pathname);
    getTaskTracker().screen(screen);
    const started = navStartedAt.current;
    if (started && started.path === pathname) {
      navStartedAt.current = null;
      const ms = slowNavMs(started.at, performance.now());
      if (ms !== null) track('slow_screen', { screen, ms });
    }
    if (getTaskTracker().isOpen('build_program') && buildProgramLeft(pathname, buildingProgramId())) getTaskTracker().abandon('build_program');
  }, [pathname]);

  // First page load.
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const ms = nav ? Math.round(nav.domContentLoadedEventEnd) : 0;
    if (ms > SLOW_MS) track('slow_screen', { screen: scrubUrl(window.location.pathname), ms });
  }, []);

  // Error messages on screen (role="alert", e.g. ErrorText): count them without reading their text.
  useEffect(() => {
    const seen = new WeakSet<Node>();
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const alerts = node.matches('[role="alert"]') ? [node] : [...node.querySelectorAll('[role="alert"]')];
          for (const el of alerts) {
            if (seen.has(el)) continue;
            seen.add(el);
            getTaskTracker().error();
            track('error_shown', { code: el.getAttribute('data-error-code') ?? 'alert', screen: scrubUrl(window.location.pathname) });
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tracker = getTaskTracker();
    const onClick = (e: MouseEvent) => {
      tracker.tap();
      const link = e.target instanceof Element ? e.target.closest('a[href^="/"]') : null;
      if (!link) return;
      const path = navTarget(link.getAttribute('href') ?? '', link.getAttribute('target') ?? '', e, window.location.origin, window.location.pathname);
      if (path) navStartedAt.current = { path, at: performance.now() };
    };
    const onBack = () => tracker.back();
    const onVisibility = () => (document.visibilityState === 'hidden' ? tracker.backgrounded() : tracker.foregrounded());
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target;
      if (form instanceof HTMLFormElement && form.getAttribute('action') === '/auth/sign-out') resetAnalytics();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('popstate', onBack);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('popstate', onBack);
    };
  }, []);

  return <>{children}</>;
}
