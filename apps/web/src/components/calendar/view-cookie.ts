import { isCalendarView, type CalendarView } from '@caltracker/shared';

/** Cookie holding "<coach id>:<view>": the coach's last picked calendar view, read by the server on first render. */
export const CALENDAR_VIEW_COOKIE = 'caltracker-calendar-view';

/** The view in the cookie when it was picked by this coach, else null (another coach on this browser, or garbage). */
export function viewFromCookie(value: string | undefined, coachId: string): CalendarView | null {
  if (!value) return null;
  const at = value.lastIndexOf(':');
  if (at < 0 || value.slice(0, at) !== coachId) return null;
  const view = value.slice(at + 1);
  return isCalendarView(view) ? view : null;
}
