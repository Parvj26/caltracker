'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, ErrorText, TextField } from '@/components/ui';
import type { ActionFailure } from '@/lib/action-result';
import { failureCode } from '@/lib/action-errors';
import { addCustomMeasure, archiveCustomMeasure } from './actions';
import type { CustomMetric } from './scan-form';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './progress.module.css';

/** Custom measures: the workspace defines them once (name, unit label, allowed range) and they join every scan form. */
export function MeasuresDialog({ customs, onClose }: { customs: CustomMetric[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function run(action: () => Promise<{ ok: true } | ActionFailure>, fallback: ErrorCode): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const outcome = await action();
      if (!outcome.ok) setError(outcome.code);
      return outcome.ok;
    } catch (e) {
      setError(failureCode(e, fallback));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add() {
    const lo = Number(min);
    const hi = Number(max);
    if (min.trim() === '' || max.trim() === '' || !Number.isFinite(lo) || !Number.isFinite(hi)) {
      setError('measure_range_not_numbers');
      return;
    }
    const ok = await run(() => addCustomMeasure({ name, unitLabel: unit, min: lo, max: hi }), 'measure_add_offline');
    if (ok) {
      setName('');
      setUnit('');
      setMin('');
      setMax('');
    }
  }

  const active = customs.filter((c) => c.archived_at === null);
  return (
    <dialog ref={dialogRef} className={calendar.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={calendar.dialogTitle}>Custom measures</h2>
      <p className={calendar.caption}>They appear on every scan form. Archiving one hides it from new scans and keeps its history.</p>
      {active.length === 0 ? (
        <p className={styles.note}>No custom measures yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Custom measures">
          {active.map((c) => (
            <li key={c.id} className={styles.listRow}>
              <span>{c.unit_label ? `${c.name} (${c.unit_label})` : c.name} · {c.min} to {c.max}</span>
              <Button variant="secondary" disabled={pending} aria-label={`Archive ${c.name}`} onClick={() => void run(() => archiveCustomMeasure(c.id), 'measure_archive_failed')}>
                Archive
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <TextField label="Measure name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <TextField label="Unit label" hint="For example in, cm or kcal. Optional." value={unit} maxLength={10} onChange={(e) => setUnit(e.target.value)} />
        <div className={styles.fields}>
          <TextField label="Smallest value" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          <TextField label="Largest value" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </div>
        {error ? <ErrorText code={error} /> : null}
        <div className={calendar.dialogActions}>
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>Done</Button>
          <Button type="submit" pending={pending}>Add measure</Button>
        </div>
      </form>
    </dialog>
  );
}
