import { addDays, monthGrid, startOfWeek } from './dates';
import type { IsoDate } from './dates';

/** The coach's calendar views: 1, 2 or 4 weeks from a Monday, or a whole month. */
export const CALENDAR_VIEWS = ['1w', '2w', '4w', 'month'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];
export const DEFAULT_CALENDAR_VIEW: CalendarView = '2w';

export const isCalendarView = (v: unknown): v is CalendarView =>
  typeof v === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(v);

const WEEKS: Record<Exclude<CalendarView, 'month'>, number> = { '1w': 1, '2w': 2, '4w': 4 };

export type CalendarRange = {
  view: CalendarView;
  /** First day shown (always a Monday). */
  start: IsoDate;
  /** Last day shown (always a Sunday). */
  end: IsoDate;
  /** Monday-first rows of seven days. */
  weeks: IsoDate[][];
  /** "YYYY-MM" in the month view (its days are the month's; the others pad the first and last rows), else null. */
  month: string | null;
};

/** "2026-11" shifted by `n` months, e.g. shiftMonth('2026-12', 1) is '2027-01'. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The days a view shows around `anchor`. Week views start on the Monday of the anchor's week and run 1, 2 or 4 whole
 * weeks; the month view is the anchor's month, padded to whole Monday-first weeks. Plain date maths in UTC, so a
 * daylight-saving change never shifts a day.
 */
export function calendarRange(view: CalendarView, anchor: IsoDate): CalendarRange {
  if (view === 'month') {
    const month = anchor.slice(0, 7);
    const weeks = monthGrid(month);
    return { view, start: weeks[0]![0]!, end: weeks.at(-1)!.at(-1)!, weeks, month };
  }
  const start = startOfWeek(anchor);
  const weeks = Array.from({ length: WEEKS[view] }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  return { view, start, end: weeks.at(-1)!.at(-1)!, weeks, month: null };
}

/**
 * The anchor `n` steps from `anchor` (negative goes back): a step is the view's length, so 2 weeks in the 2-week view
 * and a calendar month in the month view. Week views land on a Monday, the month view on the 1st.
 */
export function stepCalendar(view: CalendarView, anchor: IsoDate, n: number): IsoDate {
  if (view === 'month') return `${shiftMonth(anchor.slice(0, 7), n)}-01`;
  return addDays(startOfWeek(anchor), n * 7 * WEEKS[view]);
}

/**
 * The anchor to keep when switching views: today if today is on screen (so the coach stays on "now"), otherwise the
 * first day of the range on screen (in the month view, the 1st of the month).
 */
export function switchAnchor(range: CalendarRange, today: IsoDate): IsoDate {
  if (range.month) return today.startsWith(`${range.month}-`) ? today : `${range.month}-01`;
  return today >= range.start && today <= range.end ? today : range.start;
}

/**
 * The days to load so every view around any of `anchors` is covered (the server can't know the coach's saved view
 * or the browser's today, so it loads the union). Returns the first and last day.
 */
export function coveringRange(views: readonly CalendarView[], anchors: readonly IsoDate[]): { start: IsoDate; end: IsoDate } {
  let start: IsoDate | null = null;
  let end: IsoDate | null = null;
  for (const view of views) {
    for (const anchor of anchors) {
      const r = calendarRange(view, anchor);
      if (start === null || r.start < start) start = r.start;
      if (end === null || r.end > end) end = r.end;
    }
  }
  if (start === null || end === null) throw new Error('coveringRange needs at least one view and one anchor');
  return { start, end };
}

