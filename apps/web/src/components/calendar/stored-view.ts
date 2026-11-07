import { useSyncExternalStore } from 'react';
import { isCalendarView, type CalendarView } from '@caltracker/shared';
import { CALENDAR_VIEW_COOKIE } from './view-cookie';

// The coach's last picked calendar view, kept in this browser only (a convenience, not data): per coach, so two
// coaches sharing a computer keep their own. It goes in a cookie, so the server renders the right view first time
// (no flash of the default), and in localStorage as a fallback. Either can be missing or blocked (private windows);
// then nothing is remembered and the default view shows.
const key = (coachId: string) => `caltracker:calendar-view:${coachId}`;
const CHANGED = 'caltracker:calendar-view-changed';

function read(coachId: string): CalendarView | null {
  try {
    const v = window.localStorage.getItem(key(coachId));
    return isCalendarView(v) ? v : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The coach's remembered view, or null (none yet, on the server, and during hydration). */
export function useStoredCalendarView(coachId: string): CalendarView | null {
  return useSyncExternalStore(subscribe, () => read(coachId), () => null);
}

export function storeCalendarView(coachId: string, view: CalendarView): void {
  try {
    document.cookie = `${CALENDAR_VIEW_COOKIE}=${encodeURIComponent(`${coachId}:${view}`)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Not remembered in a cookie; localStorage below may still work.
  }
  try {
    window.localStorage.setItem(key(coachId), view);
  } catch {
    // Not remembered; the view still changes through the address.
  }
  window.dispatchEvent(new Event(CHANGED));
}
