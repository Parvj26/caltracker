'use client';

import Link from 'next/link';
import { CALENDAR_VIEWS, type CalendarView } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import styles from './calendar.module.css';

export const VIEW_LABELS: Record<CalendarView, string> = { '1w': '1 Week', '2w': '2 Week', '4w': '4 Week', month: 'Month' };
const STEP_WORDS: Record<CalendarView, string> = { '1w': 'week', '2w': '2 weeks', '4w': '4 weeks', month: 'month' };

/**
 * Above the calendar: TODAY, ‹ › (one view length back or on), the range on screen, and the view switcher. Every
 * control is a link with ?view=&from=, so reloading or sharing the address shows the same days.
 */
export function CalendarToolbar({
  view,
  title,
  todayHref,
  prevHref,
  nextHref,
  viewHref,
  onPickView,
}: {
  view: CalendarView;
  /** "November 2026", or "2 Nov – 15 Nov 2026". */
  title: string;
  todayHref: string;
  prevHref: string;
  nextHref: string;
  viewHref: (view: CalendarView) => string;
  /** Called when the coach picks a view, so it can be remembered. */
  onPickView: (view: CalendarView) => void;
}) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarNav}>
        <Link href={todayHref} className={cx(styles.monthLink, styles.todayLink)}>
          Today
        </Link>
        <Link href={prevHref} className={styles.monthLink} aria-label={`Previous ${STEP_WORDS[view]}`}>
          <span aria-hidden="true">‹</span>
        </Link>
        <Link href={nextHref} className={styles.monthLink} aria-label={`Next ${STEP_WORDS[view]}`}>
          <span aria-hidden="true">›</span>
        </Link>
        <h2 className={styles.monthTitle} aria-live="polite">
          {title}
        </h2>
      </div>
      <nav aria-label="Calendar view" className={styles.viewSwitch}>
        {CALENDAR_VIEWS.map((v) => (
          <Link
            key={v}
            href={viewHref(v)}
            className={cx(styles.viewLink, v === view && styles.viewLinkOn)}
            aria-current={v === view ? 'page' : undefined}
            onClick={() => onPickView(v)}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
