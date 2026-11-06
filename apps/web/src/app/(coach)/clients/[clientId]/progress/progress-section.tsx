'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  BUILT_IN_METRIC_KEYS,
  CHART_RANGES,
  CHART_RANGE_LABELS,
  METRICS,
  changeSince,
  displayValue,
  formatMetric,
  formatShortDate,
  measurementSeries,
} from '@caltracker/shared';
import type { BuiltInMetricKey, ChartRange, IsoDate, Units } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, Chip, ErrorText } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { deleteScan } from './actions';
import { LineChart } from './line-chart';
import type { ProgressData, ScanRow } from './load';
import { MeasuresDialog } from './measures-dialog';
import { ScanDialog } from './scan-dialog';
import { customKey } from './scan-form';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './progress.module.css';

type Editing = { scan: ScanRow | null; presetDate?: IsoDate };

/**
 * A client's body scans: Add scan, one small chart per measure with at least 2 values, and the scan history (newest
 * first). The coach edits or deletes scans; a client's own weight entries can only be deleted (a coach can't change
 * what a client entered, so "Add a new scan instead" is offered). A removed client's history is read-only.
 */
export function ProgressSection({
  workspaceId,
  client,
  units,
  data,
  readOnly,
  openScan,
}: {
  workspaceId: string;
  client: { id: string; name: string };
  units: Units;
  data: ProgressData;
  readOnly: boolean;
  /** Open the form on load (the Add scan shortcut on Home, ?scan=1). */
  openScan: boolean;
}) {
  const today = useLocalToday();
  const [range, setRange] = useState<ChartRange>('1y');
  const [editing, setEditing] = useState<Editing | null>(openScan && !readOnly ? { scan: null } : null);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<ScanRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Drop ?scan=1 once it has opened the form, so a reload doesn't open it again.
  useEffect(() => {
    if (!openScan) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('scan')) return;
    url.searchParams.delete('scan');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [openScan]);

  useEffect(() => {
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const { scans, customs } = data;
  const customByKey = new Map(customs.map((c) => [customKey(c.id), c]));
  const keys = [...BUILT_IN_METRIC_KEYS, ...customs.map((c) => customKey(c.id))];
  const nameOf = (key: string) => (Object.hasOwn(METRICS, key) ? METRICS[key as BuiltInMetricKey].label : (customByKey.get(key)?.name ?? 'Measure'));
  const format = (key: string, v: number) => formatMetric(key, v, units, customByKey.get(key));

  const charts = keys.flatMap((key) => {
    const rows = scans.flatMap((s) => (s.values[key] !== undefined ? [{ measured_on: s.measuredOn, value: s.values[key], createdAt: s.createdAt }] : []));
    const series = measurementSeries(rows, range, today);
    if (series.length === 0) return [];
    return [
      {
        key,
        title: nameOf(key),
        change: changeSince(series, key, units, today),
        points: series.map((p) => ({
          date: p.date,
          label: formatShortDate(p.date, today),
          value: displayValue(key, p.value, units),
          text: format(key, p.value),
        })),
      },
    ];
  });

  async function confirmDelete(scan: ScanRow) {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const outcome = await deleteScan(scan.id);
      if (outcome.ok) {
        setDeleting(null);
        setToast(outcome.warning ?? 'Scan deleted.');
      } else {
        setDeleteError(outcome.error);
      }
    } catch (e) {
      setDeleteError(failureMessage(e, "Couldn't delete the scan. Check your connection and try again."));
    } finally {
      setDeletePending(false);
    }
  }

  const sorted = keys.filter((k) => scans.some((s) => s.values[k] !== undefined));
  return (
    <section className={styles.section} aria-labelledby="progress-heading">
      <div className={styles.head}>
        <h2 id="progress-heading" className={styles.heading}>Progress</h2>
        <div className={styles.headActions}>
          <ul className={styles.ranges} aria-label="Chart range">
            {CHART_RANGES.map((r) => (
              <li key={r}>
                <button type="button" className={styles.range} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {CHART_RANGE_LABELS[r]}
                </button>
              </li>
            ))}
          </ul>
          {readOnly ? null : <Button onClick={() => setEditing({ scan: null })}>Add scan</Button>}
        </div>
      </div>

      {scans.length === 0 ? (
        <p className={styles.note}>No scans yet.{readOnly ? '' : ' Add the first one from the InBody printout.'}</p>
      ) : charts.length === 0 ? (
        <p className={styles.note}>Add another scan to see a trend.</p>
      ) : (
        <ul className={styles.charts} aria-label="Charts">
          {charts.map((c) => (
            <li key={c.key} className={styles.chartCard}>
              <h3 className={styles.chartTitle}>{c.title}</h3>
              <LineChart title={c.title} points={c.points} axisFormat={(v) => String(v)} />
              {c.change ? <p className={styles.chartChange}>{c.change}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {scans.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.tableCaption}>Scan history, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Values</th>
                <th scope="col">Entered by</th>
                <th scope="col">Printout</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const when = formatShortDate(s.measuredOn, today);
                return (
                  <tr key={s.id}>
                    <td className={styles.nowrap}>{when}</td>
                    <td>
                      <ul className={styles.values}>
                        {sorted.filter((k) => s.values[k] !== undefined).map((k) => (
                          <li key={k}>{nameOf(k)} {format(k, s.values[k]!)}</li>
                        ))}
                      </ul>
                    </td>
                    <td>{s.source === 'client' ? <Chip tone="blue">Logged by client</Chip> : 'Coach'}</td>
                    <td>
                      {s.printoutUrl ? (
                        <a href={s.printoutUrl} target="_blank" rel="noopener noreferrer">View printout</a>
                      ) : s.hasPrintout ? (
                        'Unavailable'
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {readOnly ? null : (
                        <div className={styles.rowActions}>
                          {s.source === 'coach' ? (
                            <button type="button" className={styles.linkButton} aria-label={`Edit scan of ${when}`} onClick={() => setEditing({ scan: s })}>
                              Edit
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={styles.linkButton}
                              aria-label={`Add a new scan instead of the entry of ${when}`}
                              onClick={() => setEditing({ scan: null, presetDate: s.measuredOn })}
                            >
                              Add a new scan instead
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.linkButton}
                            aria-label={`Delete scan of ${when}`}
                            onClick={() => {
                              setDeleteError(null);
                              setDeleting(s);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {editing ? (
        <ScanDialog
          // A fresh form (new id, empty boxes) each time it opens.
          key={editing.scan?.id ?? `new-${editing.presetDate ?? ''}`}
          workspaceId={workspaceId}
          clientId={client.id}
          units={units}
          customs={customs}
          scan={editing.scan}
          today={today}
          {...(editing.presetDate ? { presetDate: editing.presetDate } : {})}
          onSaved={(message) => {
            setEditing(null);
            setToast(message);
          }}
          onManage={() => setManaging(true)}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {managing ? <MeasuresDialog customs={customs} onClose={() => setManaging(false)} /> : null}

      {deleting ? (
        <DeleteScanDialog
          scan={deleting}
          when={formatShortDate(deleting.measuredOn, today)}
          clientName={client.name}
          pending={deletePending}
          error={deleteError}
          onDelete={() => void confirmDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      <div className={calendar.toastRegion} aria-live="assertive">
        {toast ? (
          <div className={calendar.toast}>
            <span>{toast}</span>
            {toast === STALE_DEPLOY_MESSAGE ? <ReloadButton className={calendar.smallButton} /> : null}
            <button type="button" className={calendar.smallButton} onClick={() => setToast(null)}>Dismiss</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DeleteScanDialog({
  scan,
  when,
  clientName,
  pending,
  error,
  onDelete,
  onClose,
}: {
  scan: ScanRow;
  when: string;
  clientName: string;
  pending: boolean;
  error: string | null;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={calendar.dialog} aria-labelledby={titleId} onCancel={(e) => { if (pending) e.preventDefault(); }} onClose={onClose}>
      <h2 id={titleId} className={calendar.dialogTitle}>Delete this scan?</h2>
      <p className={calendar.dialogBody}>
        The scan of {when} for {clientName}{scan.hasPrintout ? ' and its printout' : ''} will be deleted. This can&apos;t be undone.
      </p>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className={calendar.dialogActions}>
        <Button variant="secondary" onClick={() => ref.current?.close()} disabled={pending}>Cancel</Button>
        <Button onClick={onDelete} pending={pending}>{pending ? 'Deleting…' : 'Delete scan'}</Button>
      </div>
    </dialog>
  );
}
