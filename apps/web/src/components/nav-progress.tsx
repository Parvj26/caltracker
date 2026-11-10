'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './nav-progress.module.css';

/** Gives up after this long, so a navigation that never lands (an error, a cancelled tap) can't leave the bar up. */
const GIVE_UP_MS = 15_000;

/** The address a tap on this link would open inside the app, or null when it leaves the page some other way. */
function inAppTarget(event: MouseEvent): string | null {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return null;
  if (link.target && link.target !== '_self') return null;
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return url.pathname + url.search;
}

/**
 * A thin blue bar along the top of the screen from the moment a link inside the app is tapped until the new page is
 * on screen. Plain browser events and the router's own address; nothing host-specific.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;
  // The address the tap was made on. Once the router shows another address, the navigation has finished.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const pending = pendingFrom !== null && pendingFrom === here;
  // The router's address for the click handler, written the same way as `here` so the two compare.
  const hereRef = useRef(here);
  useEffect(() => {
    hereRef.current = here;
    // Landed somewhere else: forget the tap, or coming back to this address later (Back) would show the bar again.
    setPendingFrom((from) => (from !== null && from !== here ? null : from));
  }, [here]);

  useEffect(() => {
    // Capture phase: next/link cancels the click's default before it bubbles, so listen on the way down instead.
    const onClick = (event: MouseEvent) => {
      const target = inAppTarget(event);
      const current = window.location.pathname + window.location.search;
      if (target && target !== current) setPendingFrom(hereRef.current);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setPendingFrom(null), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (!pending) return null;
  return <div className={styles.bar} role="progressbar" aria-label="Loading page" data-testid="nav-progress" />;
}
