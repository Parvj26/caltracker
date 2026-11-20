'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { BUILT_IN_METRIC_KEYS, METRICS, changeSince, formatMetric, formatShortDate } from '@caltracker/shared';
import type { BuiltInMetricKey, IsoDate, Units } from '@caltracker/shared';
import { MoreMenu, type MoreMenuItem } from '@/components/more-menu';
import { ReloadButton } from '@/components/reload-button';
import { Button, Chip, ErrorText } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureCode } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { deleteScan } from './actions';
import type { ProgressData, ScanRow } from './load';
import { MeasuresDialog } from './measures-dialog';
import { ScanDialog } from './scan-dialog';
import { customKey } from './scan-form';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './progress.module.css';
import { openLayer } from '@/lib/open-layer';
import { useSheetOnLoad } from '@/lib/use-sheet-on-load';

type Editing = { scan: ScanRow | null; presetDate?: IsoDate };

/**
 * A client's InBody scans (Metrics tab, under Body and Strength): Add scan and the scan history, newest first, with
 * printouts. The Body cards above show the trends. The coach edits or deletes scans; a client's own weight entries can only be deleted (a coach can't change
 * what a client entered, so "Add a new scan instead" is offered). A removed client's history is read-only.
 */
export function ProgressSection({
  workspaceId,
  client,
  units,
  data,
  readOnly,
  openScan,
  scanRequest = 0,
}: {
  workspaceId: string;
  client: { id: string; name: string };
  units: Units;
  data: ProgressData;
  readOnly: boolean;
  /** Open the form on load (the Add scan shortcut on Home, ?scan=1). */
  openScan: boolean;
  /** Goes up by one each time something else on the page asks for the scan form (+ Log metric's "Add a full InBody scan"). */
  scanRequest?: number;
}) {
  const today = useLocalToday();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<ScanRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<ErrorCode | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Drop ?scan=1 from the address first, then open the form (it adds its own ?sheet= step on top of the clean
  // address), so a reload or Back doesn't open it again.
  useEffect(() => {
    if (!openScan) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('scan')) {
      url.searchParams.delete('scan');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    if (readOnly) return;
    // Opening only after the address is clean is the point here (the form's own history step copies the address).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing({ scan: null });
  }, [openScan, readOnly]);

  useEffect(() => {
    if (scanRequest === 0 || readOnly) return;
    // Opened on request from another pop-up that has just closed (never one dialog on top of another).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing({ scan: null });
  }, [scanRequest, readOnly]);

  useEffect(() => {
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const { scans, customs } = data;
  // A refresh or shared link with ?sheet=add-scan / edit-scan-<id> opens that form again (UI rules §8.3).
  useSheetOnLoad((id) => {
    if (readOnly) return false;
    if (id === 'add-scan') {
      setEditing({ scan: null });
      return true;
    }
    const scan = id.startsWith('edit-scan-') ? scans.find((s) => `edit-scan-${s.id}` === id && s.source === 'coach') : undefined;
    if (!scan) return false;
    setEditing({ scan });
    return true;
  });
  const customByKey = new Map(customs.map((c) => [customKey(c.id), c]));
  const keys = [...BUILT_IN_METRIC_KEYS, ...customs.map((c) => customKey(c.id))];
  const nameOf = (key: string) => (Object.hasOwn(METRICS, key) ? METRICS[key as BuiltInMetricKey].label : (customByKey.get(key)?.name ?? 'Measure'));
  const format = (key: string, v: number) => formatMetric(key, v, units, customByKey.get(key));

  async function confirmDelete(scan: ScanRow) {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const outcome = await deleteScan(scan.id);
      if (outcome.ok) {
        setDeleting(null);
        setToast(outcome.warning ?? 'Scan deleted.');
      } else {
        setDeleteError(outcome.code);
      }
    } catch (e) {
      setDeleteError(failureCode(e, 'scan_delete_offline'));
    } finally {
      setDeletePending(false);
    }
  }

  const sorted = keys.filter((k) => scans.some((s) => s.values[k] !== undefined));

  // The phone card's ⋯: Edit (or, for a client's own entry, Add a new scan instead), then Delete in red.
  const scanMenu = (s: ScanRow): MoreMenuItem[] => [
    s.source === 'coach'
      ? { label: 'Edit scan', onSelect: () => setEditing({ scan: s }) }
      : { label: 'Add a new scan instead', onSelect: () => setEditing({ scan: null, presetDate: s.measuredOn }) },
    {
      label: 'Delete scan…',
      danger: true,
      onSelect: () => {
        setDeleteError(null);
        setDeleting(s);
      },
    },
  ];
  // Change from the scan before (scans are newest first): "−0.6 since 6 Nov" on the first value, "−0.8" after it.
  const changeFrom = (index: number, key: string, first: boolean): string | null => {
    const scan = scans[index]!;
    const before = scans.slice(index + 1).find((p) => p.values[key] !== undefined);
    if (!before) return null;
    const text = changeSince(
      [
        { date: before.measuredOn, value: before.values[key]! },
        { date: scan.measuredOn, value: scan.values[key]! },
      ],
      key,
      units,
      today,
    );
    return text && !first ? text.replace(/ since .*$/, '') : text;
  };

  return (
    <section className={styles.section} aria-labelledby="progress-heading">
      <div className={styles.head}>
        <h2 id="progress-heading" className={styles.heading}>InBody scans</h2>
        <div className={styles.headActions}>
          {readOnly ? null : <Button variant="create" onClick={() => setEditing({ scan: null })}>+ Add scan</Button>}
        </div>
      </div>

      {scans.length === 0 ? (
        <p className={styles.note}>No scans yet.{readOnly ? '' : ' Add the first one from the InBody printout.'}</p>
      ) : null}

      {scans.length > 0 ? (
        <>
          {/* Phones: one card per scan. Tablets and desktops: the table below (only one of the two is shown). */}
          <div className={styles.scanCards}>
            <div className={styles.cardsHead}>
              <h3 className={styles.cardsTitle}>Scan history</h3>
              <span className={styles.cardsNote}>newest first</span>
            </div>
            <ul className={styles.cardList} aria-label="Scan history, newest first">
              {scans.map((s, i) => {
                const when = formatShortDate(s.measuredOn, today);
                const shown = sorted.filter((k) => s.values[k] !== undefined);
                return (
                  <li key={s.id} className={styles.scanCard}>
                    <div className={styles.scanCardTop}>
                      <div className={styles.scanWho}>
                        <span className={styles.scanDate}>{when}</span>
                        <span className={styles.scanBy}>Entered by {s.source === 'client' ? client.name : 'you'}</span>
                      </div>
                      {s.printoutUrl ? (
                        <a className={styles.printout} href={s.printoutUrl} target="_blank" rel="noopener noreferrer" aria-label={`Printout of ${when}`}>
                          Printout
                        </a>
                      ) : s.hasPrintout ? (
                        <span className={styles.scanBy}>Printout unavailable</span>
                      ) : null}
                      {readOnly ? null : <MoreMenu label={`More for the ${when} scan`} items={scanMenu(s)} />}
                    </div>
                    <dl className={styles.scanValues}>
                      {shown.map((k, j) => {
                        const change = changeFrom(i, k, j === 0);
                        return (
                          <div key={k} className={styles.scanValue}>
                            <dt>{nameOf(k)}</dt>
                            <dd className={styles.scanNumber}>{format(k, s.values[k]!)}</dd>
                            {change ? <dd className={styles.scanChange}>{change}</dd> : null}
                          </div>
                        );
                      })}
                    </dl>
                  </li>
                );
              })}
            </ul>
          </div>
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
        </>
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
          onWarning={setToast}
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
  error: ErrorCode | null;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog) openLayer(dialog);
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
      {error ? <ErrorText code={error} /> : null}
      <div className={calendar.dialogActions}>
        <Button variant="secondary" onClick={() => ref.current?.close()} disabled={pending}>Cancel</Button>
        <Button onClick={onDelete} pending={pending}>{pending ? 'Deleting…' : 'Delete scan'}</Button>
      </div>
    </dialog>
  );
}
