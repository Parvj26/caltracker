'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  METRIC_CATALOGUE,
  METRIC_RANGE_LABELS,
  formatMetricDelta,
  isMetricKey,
  metricEntryMeta,
  metricToDisplay,
  metricValueParts,
  metricsSummary,
  type MetricEntry,
  type MetricKey,
  type MetricRange,
  type MetricSummary,
  type Units,
} from '@caltracker/shared';
import { Sparkline } from '@/components/strength/sparkline';
import { Button } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { bodyMetricHref } from '@/lib/metrics-paths';
import { useSheetOnLoad } from '@/lib/use-sheet-on-load';
import type { ProgressData } from '../progress/load';
import { ProgressSection } from '../progress/progress-section';
import { LogMetricDialog } from './log-metric-dialog';
import { MetricsToast, RangeControl, useMetricRange } from './range-control';
import layout from '@/components/ui/layout.module.css';
import styles from './metrics.module.css';

type Client = { id: string; name: string; firstName: string };

/**
 * The Metrics tab: Body (a card per metric with its latest value, trend line and change over the range, each opening
 * the metric's page; + Log metric), then Strength (passed in, drawn on the server) and the InBody scan history.
 */
export function MetricsView({
  workspaceId,
  client,
  units,
  entries,
  progress,
  readOnly,
  openScan,
  strength,
}: {
  workspaceId: string;
  client: Client;
  units: Units;
  entries: MetricEntry[];
  progress: ProgressData;
  readOnly: boolean;
  openScan: boolean;
  strength: ReactNode;
}) {
  const today = useLocalToday();
  const [range, setRange] = useMetricRange();
  const [logging, setLogging] = useState<MetricKey | null>(null);
  const [scanRequest, setScanRequest] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const summaries = metricsSummary(entries, range, today);

  // ?sheet=log-metric (a refresh, or Overview's "+ Log metric") opens the form again (UI rules §8.3).
  useSheetOnLoad((id) => {
    if (readOnly || id !== 'log-metric') return false;
    const pick = new URLSearchParams(window.location.search).get('metric');
    setLogging(isMetricKey(pick) ? pick : 'weight_kg');
    return true;
  });

  useEffect(() => {
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <section className={styles.section} aria-labelledby="body-metrics-heading" data-testid="body-metrics">
        <div className={styles.head}>
          <h2 id="body-metrics-heading" className={styles.heading}>Body</h2>
          <RangeControl range={range} onChange={setRange} />
          {readOnly ? null : (
            <Button variant="create" size="compact" onClick={() => setLogging('weight_kg')} phSafe>
              + Log metric
            </Button>
          )}
        </div>
        <ul className={styles.cards} aria-label="Body metrics">
          {summaries.map((s) => (
            <li key={s.key}>
              <MetricCard
                summary={s}
                range={range}
                units={units}
                today={today}
                client={client}
                readOnly={readOnly}
                onLog={() => setLogging(s.key)}
              />
            </li>
          ))}
        </ul>
      </section>

      {strength}

      <ProgressSection
        workspaceId={workspaceId}
        client={{ id: client.id, name: client.name }}
        units={units}
        data={progress}
        readOnly={readOnly}
        openScan={openScan}
        scanRequest={scanRequest}
      />

      {logging ? (
        <LogMetricDialog
          key={logging}
          clientId={client.id}
          clientFirstName={client.firstName}
          units={units}
          today={today}
          entries={entries}
          initialMetric={logging}
          onSaved={setToast}
          onClose={() => setLogging(null)}
          onAddScan={() => setScanRequest((n) => n + 1)}
        />
      ) : null}
      <MetricsToast text={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function MetricCard({
  summary,
  range,
  units,
  today,
  client,
  readOnly,
  onLog,
}: {
  summary: MetricSummary;
  range: MetricRange;
  units: Units;
  today: string;
  client: Client;
  readOnly: boolean;
  onLog: () => void;
}) {
  const { key, latest, change, points } = summary;
  const label = METRIC_CATALOGUE[key].label;
  if (!latest) {
    const body = (
      <>
        <span className={styles.name}>{label}</span>
        <span className={styles.value}><span className={styles.number} aria-hidden="true">—</span></span>
        <span className={styles.meta}>
          Not logged yet{readOnly ? null : <> · <span className={styles.logHint}>+ Log</span></>}
        </span>
      </>
    );
    return readOnly ? (
      <div className={styles.card} data-metric={key}>{body}</div>
    ) : (
      <button type="button" className={styles.card} data-metric={key} onClick={onLog}>
        {body}
      </button>
    );
  }
  const parts = metricValueParts(key, latest.value, units);
  const meta = metricEntryMeta(latest, today, 'coach', client.firstName);
  const changeText = change !== null ? formatMetricDelta(key, change, units) : null;
  const over = METRIC_RANGE_LABELS[range] === 'All' ? 'all time' : METRIC_RANGE_LABELS[range];
  const href = `${bodyMetricHref(client.id, key)}${range === '1y' ? '' : `?range=${range}`}`;
  return (
    // No aria-label: the visible text, in reading order, is the link's name ("Weight 68.4 kg −2.1 kg over 1 year Today ·
    // logged by Maya"); the grid places the change top right.
    <Link href={href} className={styles.card} data-metric={key}>
      <span className={styles.name}>{label}</span>
      <span className={styles.value}>
        <span className={styles.number}>{parts.value}</span>{' '}
        <span className={styles.unit}>{parts.unit}</span>
      </span>
      {changeText ? (
        <span className={styles.change}>
          {changeText}
          <span className={layout.srOnly}> over {over}</span>
        </span>
      ) : null}
      <Sparkline values={points.map((p) => metricToDisplay(key, p.value, units))} className={styles.spark} />
      <span className={styles.meta}>{meta}</span>
    </Link>
  );
}
