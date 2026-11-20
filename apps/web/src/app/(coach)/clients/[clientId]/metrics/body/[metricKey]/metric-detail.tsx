'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  METRIC_CATALOGUE,
  METRIC_RANGE_LABELS,
  addDays,
  canEditMetricEntry,
  diffDays,
  formatMetricDelta,
  formatMetricValue,
  formatShortDate,
  metricEntryMeta,
  metricSummary,
  metricToDisplay,
  metricUnit,
  shortDate,
  type ErrorCode,
  type MetricEntry,
  type MetricKey,
  type Units,
} from '@caltracker/shared';
import { LineChart } from '@/components/charts/line-chart';
import { MoreMenu } from '@/components/more-menu';
import { AdaptiveDialog, Button, ButtonLink, ErrorText, ListRow, PageHeader, RowList, type AdaptiveDialogHandle } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureCode } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { useSheetOnLoad } from '@/lib/use-sheet-on-load';
import { deleteMetricEntry } from '../../actions';
import { LogMetricDialog, metricWord } from '../../log-metric-dialog';
import { MetricsToast, RangeControl, useMetricRange } from '../../range-control';
import styles from '../../metrics.module.css';

const EPOCH = '2000-01-01';
const RANGE_DAYS = { '3m': 91, '1y': 365, all: null } as const;

type Editing = { entry: MetricEntry | null };

/** A metric's page: latest value and change, chart, entries (Edit / Delete… on the coach's own, printout on scans). */
export function MetricDetail({
  back,
  client,
  metricKey,
  units,
  entries,
  printouts,
  readOnly,
}: {
  back: ReactNode;
  client: { id: string; firstName: string };
  metricKey: MetricKey;
  units: Units;
  entries: MetricEntry[];
  /** Signed printout links by scan id. */
  printouts: Record<string, string>;
  readOnly: boolean;
}) {
  const today = useLocalToday();
  const [range, setRange] = useMetricRange();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<MetricEntry | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const def = METRIC_CATALOGUE[metricKey];
  const word = metricWord(metricKey);
  const summary = metricSummary(entries, metricKey, range, today);
  const days = RANGE_DAYS[range];
  const from = days === null ? null : addDays(today, -days);
  const shown = entries
    .filter((e) => from === null || e.measuredOn >= from)
    .sort((a, b) => (a.measuredOn !== b.measuredOn ? (a.measuredOn < b.measuredOn ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  const editable = (e: MetricEntry) => !readOnly && canEditMetricEntry(e, 'coach');

  useSheetOnLoad((id) => {
    if (readOnly) return false;
    if (id === 'log-metric') {
      setEditing({ entry: null });
      return true;
    }
    const entry = id.startsWith('edit-metric-') ? entries.find((e) => `edit-metric-${e.id}` === id && editable(e)) : undefined;
    if (!entry) return false;
    setEditing({ entry });
    return true;
  });

  useEffect(() => {
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const latest = summary.latest;
  const unit = metricUnit(metricKey, units);
  const yLabel = (y: number) => (def.kind === 'percent' ? `${y.toFixed(def.decimals)}%` : `${y.toFixed(def.decimals)} ${unit}`);
  const points = summary.points.map((p) => ({
    x: diffDays(EPOCH, p.date),
    y: metricToDisplay(metricKey, p.value, units),
    label: `${formatShortDate(p.date, today)}: ${formatMetricValue(metricKey, p.value, units)}`,
  }));
  const first = summary.points[0];
  const last = summary.points.at(-1);
  const chartSummary =
    first && last && summary.points.length > 1
      ? `${def.label} went from ${formatMetricValue(metricKey, first.value, units)} on ${formatShortDate(first.date, today)} to ${formatMetricValue(metricKey, last.value, units)} on ${formatShortDate(last.date, today)}.`
      : `${def.label}: ${summary.points.length} value in this range.`;
  const over = range === 'all' ? 'all time' : METRIC_RANGE_LABELS[range];

  return (
    <div className={styles.page}>
      {back}
      <PageHeader
        title={def.longLabel}
        action={
          readOnly ? undefined : (
            <Button variant="create" size="compact" onClick={() => setEditing({ entry: null })} aria-label={`Log ${word}`}>
              + Log
            </Button>
          )
        }
      />

      <section className={styles.latest} aria-label="Latest" data-testid="metric-latest">
        <span className={styles.name}>Latest</span>
        {latest ? (
          <>
            <span className={styles.latestRow}>
              <span className={styles.number}>{formatMetricValue(metricKey, latest.value, units)}</span>
              {summary.change !== null ? <span className={styles.change}>{formatMetricDelta(metricKey, summary.change, units)} over {over}</span> : null}
            </span>
            <span className={styles.meta}>{metricEntryMeta(latest, today, 'coach', client.firstName)}</span>
          </>
        ) : (
          <span className={styles.meta}>Not logged yet</span>
        )}
      </section>

      <nav aria-label="Range" className={styles.rangeNav}>
        <RangeControl range={range} onChange={setRange} />
      </nav>

      {points.length === 0 ? (
        <p className={styles.empty}>
          {entries.length === 0 ? `No ${word} logged yet.` : 'No entries in this range.'}{' '}
          {entries.length > 0 && range !== 'all' ? (
            <button type="button" className={styles.linkButton} onClick={() => setRange('all')}>Show all</button>
          ) : null}
        </p>
      ) : (
        <LineChart
          key={range}
          title={`${def.label}, ${over}`}
          points={points}
          summary={chartSummary}
          summaryHidden
          yLabel={yLabel}
          xLabel={(x) => shortDate(addDays(EPOCH, x))}
        />
      )}

      {shown.length > 0 ? (
        <section className={styles.entries} aria-labelledby="metric-entries-heading">
          <h2 id="metric-entries-heading" className={styles.entriesHeading}>Entries</h2>
          <RowList aria-labelledby="metric-entries-heading" data-testid="metric-entries">
            {shown.map((e) => {
              const when = formatShortDate(e.measuredOn, today);
              const value = formatMetricValue(metricKey, e.value, units);
              const printout = e.source === 'inbody_scan' ? printouts[e.id] : undefined;
              return (
                <ListRow
                  key={`${e.origin}-${e.id}`}
                  title={value}
                  meta={metricEntryMeta(e, today, 'coach', client.firstName)}
                  itemProps={{ 'data-entry': `${when} ${value}` }}
                  action={
                    printout ? (
                      <ButtonLink variant="quiet" size="compact" href={printout} target="_blank" rel="noopener noreferrer" aria-label={`View printout of the ${when} scan`}>
                        View printout
                      </ButtonLink>
                    ) : undefined
                  }
                  more={
                    editable(e) ? (
                      <MoreMenu
                        label={`More for ${value} on ${when}`}
                        items={[
                          { label: 'Edit entry', onSelect: () => setEditing({ entry: e }) },
                          { label: 'Delete entry…', danger: true, onSelect: () => setDeleting(e) },
                        ]}
                      />
                    ) : undefined
                  }
                />
              );
            })}
          </RowList>
        </section>
      ) : null}

      {editing ? (
        <LogMetricDialog
          key={editing.entry?.id ?? 'new'}
          clientId={client.id}
          clientFirstName={client.firstName}
          units={units}
          today={today}
          entries={entries}
          initialMetric={metricKey}
          entry={editing.entry ?? undefined}
          onSaved={setToast}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteEntryDialog
          entry={deleting}
          text={`${formatMetricValue(metricKey, deleting.value, units)} on ${formatShortDate(deleting.measuredOn, today)}`}
          word={word}
          onDeleted={() => setToast('Entry deleted.')}
          onClose={() => setDeleting(null)}
        />
      ) : null}
      <MetricsToast text={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function DeleteEntryDialog({ entry, text, word, onDeleted, onClose }: { entry: MetricEntry; text: string; word: string; onDeleted: () => void; onClose: () => void }) {
  const ref = useRef<AdaptiveDialogHandle>(null);
  const bodyId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const outcome = await deleteMetricEntry(entry.id);
      if (outcome.ok || outcome.code === 'metric_already_gone') {
        await ref.current?.close();
        onDeleted();
        return;
      }
      setError(outcome.code);
    } catch (e) {
      setError(failureCode(e, 'metric_delete_failed'));
    } finally {
      setPending(false);
    }
  }
  return (
    <AdaptiveDialog
      ref={ref}
      historyId={`delete-metric-${entry.id}`}
      role="alertdialog"
      describedBy={bodyId}
      title={`Delete this ${word} entry?`}
      titleSafe
      busy={pending}
      stackFooterOnPhone
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => ref.current?.requestClose()} disabled={pending} phSafe>Cancel</Button>
          <Button variant="danger" onClick={() => void confirm()} pending={pending} phSafe>{pending ? 'Deleting…' : 'Delete entry'}</Button>
        </>
      }
    >
      <p id={bodyId} className={styles.empty}>{text} will be deleted. This can’t be undone.</p>
      {error ? <ErrorText code={error} /> : null}
    </AdaptiveDialog>
  );
}
