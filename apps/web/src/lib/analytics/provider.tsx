'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { scrubUrl } from '@caltracker/shared';
import { getTaskTracker, identifyPerson, initAnalytics, resetAnalytics, type AnalyticsPerson } from './client';

/** Starts analytics for a signed-in coach and feeds taps, back presses, screens and tab visibility to the task tracker. */
export function AnalyticsProvider({ person, children }: { person: AnalyticsPerson; children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    initAnalytics();
    identifyPerson(person);
  }, [person]);

  useEffect(() => {
    getTaskTracker().screen(scrubUrl(pathname));
  }, [pathname]);

  useEffect(() => {
    const tracker = getTaskTracker();
    const onClick = () => tracker.tap();
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
