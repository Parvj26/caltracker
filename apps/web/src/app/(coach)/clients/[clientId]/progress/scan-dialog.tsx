'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IsoDateSchema, errorMessage, type ErrorCode } from '@caltracker/shared';
import type { IsoDate, Units } from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, TextField, errorFromText, type FieldError } from '@/components/ui';
import { failureCode, isStaleDeployError } from '@/lib/action-errors';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { saveScan } from './actions';
import { preparePrintout, type Printout } from './compress';
import type { ScanRow } from './load';
import { inputsFor, parseScanForm, scanFields, type CustomMetric } from './scan-form';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './progress.module.css';

/**
 * The scan form: a date, the standard measures, the workspace's custom measures and one printout. `scan` is the
 * scan being edited, or null for a new one. The scan's id is made once when the form opens, so a retry after a
 * dropped connection saves the same scan instead of adding a second.
 */
export function ScanDialog({
  workspaceId,
  clientId,
  units,
  customs,
  scan,
  today,
  presetDate,
  onSaved,
  onManage,
  onWarning,
  onClose,
}: {
  workspaceId: string;
  clientId: string;
  units: Units;
  customs: CustomMetric[];
  scan: ScanRow | null;
  today: IsoDate;
  /** The date a new scan starts with (default today). */
  presetDate?: IsoDate;
  onSaved: (message: string) => void;
  onManage: () => void;
  onWarning: (message: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [scanId] = useState(() => scan?.id ?? crypto.randomUUID());
  const [original] = useState(() => (scan ? { values: scan.values, inputs: inputsFor(scan.values, units) } : undefined));
  const [date, setDate] = useState<string>(scan?.measuredOn ?? presetDate ?? today);
  const [inputs, setInputs] = useState<Record<string, string>>(() => ({ ...original?.inputs }));
  const [printout, setPrintout] = useState<Printout | null>(null);
  const [removePrintout, setRemovePrintout] = useState(false);
  const [fileError, setFileError] = useState<ErrorCode | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<FieldError | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const fields = scanFields(customs, units, new Set(Object.keys(scan?.values ?? {})));
  const parsedDate = IsoDateSchema.safeParse(date);
  const dateError = !parsedDate.success ? 'Pick a date.' : parsedDate.data > today ? "The date can't be in the future." : null;

  async function onFile(file: File | undefined) {
    setPrintout(null);
    setFileError(null);
    if (!file) return;
    try {
      setPrintout(await preparePrintout(file));
    } catch {
      setFileError('scan_printout_invalid_file');
    }
  }

  async function save() {
    if (busy.current) return;
    setFormError(null);
    const parsed = parseScanForm(inputs, fields, customs, units, original);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) {
      if (parsed.form) setFormError(errorFromText(parsed.form, 'scan_invalid'));
      return;
    }
    if (dateError || !parsedDate.success || fileError) return;

    busy.current = true;
    setPending(true);
    let uploaded: string | null = null;
    try {
      let attachment: string | null | undefined;
      if (printout) {
        uploaded = `${workspaceId}/${clientId}/${crypto.randomUUID()}.${printout.ext}`;
        const up = await createBrowserSupabase().storage.from('scan-attachments').upload(uploaded, printout.blob, { contentType: printout.contentType });
        if (up.error) {
          uploaded = null;
          setFormError({ code: 'scan_printout_upload_failed' });
          return;
        }
        attachment = uploaded;
      } else if (removePrintout) {
        attachment = null;
      }
      const outcome = await saveScan({
        id: scanId,
        clientId,
        measuredOn: parsedDate.data,
        values: parsed.values,
        ...(attachment !== undefined ? { attachmentPath: attachment } : {}),
      });
      if (outcome.ok) {
        uploaded = null; // saved: the file stays
        onSaved(outcome.warning ?? (scan ? 'Scan updated.' : 'Scan added.'));
        return;
      }
      uploaded = null; // the server already took the file back
      setFormError({ code: outcome.code, text: outcome.warning ? `${errorMessage(outcome.code)} ${outcome.warning}` : undefined });
      if (outcome.warning) onWarning(outcome.warning);
    } catch (e) {
      // The row may have been saved even though the answer never arrived, so the file stays: a leftover file is
      // better than a scan whose printout link is broken. Only a call that certainly never ran takes it back.
      if (!isStaleDeployError(e)) uploaded = null;
      setFormError({ code: failureCode(e, 'scan_save_offline') });
    } finally {
      // The file of a save that certainly never reached the server (a stale page) is removed here, best effort.
      if (uploaded) void createBrowserSupabase().storage.from('scan-attachments').remove([uploaded]);
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={calendar.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId} className={calendar.dialogTitle}>{scan ? 'Edit scan' : 'Add a scan'}</h2>
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Date"
          type="date"
          max={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          {...(dateError ? { error: errorFromText(dateError, 'field_format') } : {})}
        />
        <div className={styles.fields}>
          {fields.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              labelSafe={!f.key.startsWith('custom:')}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={inputs[f.key] ?? ''}
              onChange={(e) => setInputs((s) => ({ ...s, [f.key]: e.target.value }))}
              {...(errors[f.key] ? { error: { ...errorFromText(errors[f.key]!, 'field_format'), safe: !f.key.startsWith('custom:') } } : {})}
            />
          ))}
        </div>
        <Button variant="secondary" onClick={onManage}>Manage custom measures</Button>

        <div className={styles.fileRow}>
          <label className={styles.fileLabel} htmlFor={`${titleId}-file`}>Printout (image or PDF, up to 5 MB)</label>
          <input id={`${titleId}-file`} type="file" accept="image/*,application/pdf" onChange={(e) => void onFile(e.target.files?.[0])} />
          {fileError ? <ErrorText code={fileError} /> : null}
          {scan?.hasPrintout && !printout ? (
            <label>
              <input type="checkbox" checked={removePrintout} onChange={(e) => setRemovePrintout(e.target.checked)} /> Remove the current printout
            </label>
          ) : null}
        </div>

        {formError ? <ErrorText code={formError.code}>{formError.text}</ErrorText> : null}
        <div className={calendar.dialogActions}>
          {formError?.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
          <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>Cancel</Button>
          <Button type="submit" pending={pending}>{pending ? 'Saving…' : 'Save scan'}</Button>
        </div>
      </form>
    </dialog>
  );
}
