'use client';

import { METRIC_RANGES, METRIC_RANGE_LABELS, type MetricRange } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { STALE_DEPLOY_MESSAGE } from '@/lib/action-errors';
import { useUrlChoice } from '@/lib/url-state';
import calendar from '@/components/calendar/calendar.module.css';
import { cx } from '@/components/ui/cx';
import styles from './metrics.module.css';

/** The Metrics range (3 months / 1 year / All), kept in the address (?range=) without a history step. */
export function useMetricRange(): [MetricRange, (r: MetricRange) => void] {
  return useUrlChoice<MetricRange>('range', METRIC_RANGES, '1y');
}

/** The range as a segmented control: the chosen one is a white pill with an ink border. */
export function RangeControl({ range, onChange, className }: { range: MetricRange; onChange: (r: MetricRange) => void; className?: string | undefined }) {
  return (
    <ul className={cx(styles.ranges, className)} aria-label="Range">
      {METRIC_RANGES.map((r) => (
        <li key={r} style={{ display: 'contents' }}>
          <button type="button" className={styles.range} aria-pressed={range === r} onClick={() => onChange(r)}>
            {METRIC_RANGE_LABELS[r]}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One short message at the bottom ("Weight saved."), with Reload after a new release. */
export function MetricsToast({ text, onDismiss }: { text: string | null; onDismiss: () => void }) {
  return (
    <div className={calendar.toastRegion} aria-live="polite" role="status">
      {text ? (
        <div className={calendar.toast}>
          <span className={styles.toastText}>{text}</span>
          {text === STALE_DEPLOY_MESSAGE ? <ReloadButton className={calendar.smallButton} /> : null}
          <button type="button" className={calendar.smallButton} onClick={onDismiss}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
}
