'use client';

import { useId, useRef, useState } from 'react';
import {
  IsoDateSchema,
  METRIC_CATALOGUE,
  METRIC_KEYS,
  formatMetricValue,
  formatShortDate,
  metricDailyEntries,
  metricEntryWho,
  metricInputValue,
  metricUnit,
  parseMetricInput,
  type IsoDate,
  type MetricEntry,
  type MetricKey,
  type Units,
} from '@caltracker/shared';
import { ReloadButton } from '@/components/reload-button';
import { AdaptiveDialog, Button, ErrorText, TextField, errorFromText, type AdaptiveDialogHandle, type FieldError } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { failureCode } from '@/lib/action-errors';
import calendar from '@/components/calendar/calendar.module.css';
import { saveMetricEntry } from './actions';
import styles from './metrics.module.css';

/** "weight", "body fat", but "VO2 max" (an abbreviation keeps its capitals). */
export function metricWord(key: MetricKey): string {
  const label = METRIC_CATALOGUE[key].label;
  return /^[A-Z0-9]{2,}/.test(label) ? label : label.toLowerCase();
}

/**
 * "+ Log metric" (and Edit on a metric's page): pick one of the six metrics, type the value in the coach's units (the
 * unit sits inside the box), pick the day (today by default, never later). Shows the metric's last value as a hint.
 * "Add a full InBody scan" closes this and opens the scan form instead (never one pop-up on another). The entry's id
 * is made when the form opens, so a retry after a dropped connection saves the same entry instead of a second one.
 */
export function LogMetricDialog({
  clientId,
  clientFirstName,
  units,
  today,
  entries,
  initialMetric = 'weight_kg',
  entry,
  onSaved,
  onClose,
  onAddScan,
}: {
  clientId: string;
  clientFirstName: string;
  units: Units;
  today: IsoDate;
  /** The client's values (for the "Last: …" hint). */
  entries: readonly MetricEntry[];
  initialMetric?: MetricKey;
  /** The coach's own entry being changed (its metric is fixed), or none for a new one. */
  entry?: MetricEntry | undefined;
  onSaved: (message: string) => void;
  onClose: () => void;
  /** Leave this for the full scan form; left out where there is none (a removed client). */
  onAddScan?: (() => void) | undefined;
}) {
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const formId = useId();
  const valueId = useId();
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [metric, setMetric] = useState<MetricKey>(entry?.metricKey ?? initialMetric);
  const startValue = entry ? String(metricInputValue(entry.metricKey, entry.value, units)) : '';
  const startDate = entry?.measuredOn ?? today;
  const [value, setValue] = useState(startValue);
  const [date, setDate] = useState<string>(startDate);
  const [valueError, setValueError] = useState<string | null>(null);
  const [dateTouched, setDateTouched] = useState(false);
  const [formError, setFormError] = useState<FieldError | null>(null);
  const [pending, setPending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const busy = useRef(false);

  const dirty = value.trim() !== startValue.trim() || date !== startDate;
  const word = metricWord(metric);
  const parsedDate = IsoDateSchema.safeParse(date);
  const dateError = !parsedDate.success ? 'Pick a date.' : parsedDate.data > today ? "The date can't be in the future." : null;

  const last = metricDailyEntries(
    entries.filter((e) => e.id !== entry?.id || e.origin !== entry.origin),
    metric,
  ).at(-1);
  const lastText = last
    ? `Last: ${formatMetricValue(metric, last.value, units)} on ${formatShortDate(last.measuredOn, today)} (${metricEntryWho(last, 'coach', clientFirstName)})`
    : `No ${word} logged yet.`;

  const check = (v: string): string | null => {
    const parsed = parseMetricInput(metric, v, units);
    return parsed.ok ? null : parsed.error;
  };

  async function save() {
    if (busy.current) return;
    setFormError(null);
    setDateTouched(true);
    const parsed = parseMetricInput(metric, value, units);
    setValueError(parsed.ok ? null : parsed.error);
    if (!parsed.ok) {
      document.getElementById(valueId)?.focus();
      return;
    }
    if (dateError || !parsedDate.success) return;
    busy.current = true;
    setPending(true);
    try {
      const outcome = await saveMetricEntry({ id, clientId, metricKey: metric, measuredOn: parsedDate.data, value: parsed.value });
      if (outcome.ok) {
        await dialogRef.current?.close();
        const label = METRIC_CATALOGUE[metric].label;
        onSaved(entry ? `${label} updated.` : `${label} saved.`);
        return;
      }
      setFormError({ code: outcome.code });
    } catch (e) {
      setFormError({ code: failureCode(e, 'metric_save_failed') });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function toScan() {
    await dialogRef.current?.close();
    onAddScan?.();
  }

  const unit = metricUnit(metric, units);
  const valueErrorId = `${valueId}-error`;
  const hintId = `${valueId}-hint`;
  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId={entry ? `edit-metric-${entry.id}` : 'log-metric'}
      title={entry ? `Edit ${word}` : 'Log a metric'}
      titleSafe
      onClose={onClose}
      dirty={dirty}
      discardText="The value you typed isn’t saved yet."
      busy={pending}
      footer={
        <>
          {formError?.code === 'stale_deploy' ? <ReloadButton className={calendar.smallButton} /> : null}
          <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()} disabled={pending} phSafe>Cancel</Button>
          <Button type="submit" form={formId} pending={pending} phSafe>{pending ? 'Saving…' : `Save ${word}`}</Button>
        </>
      }
    >
      <form
        id={formId}
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {entry ? null : (
          <fieldset className={styles.chipsField}>
            <legend className={styles.legend}>Metric</legend>
            <div className={styles.chips}>
              {METRIC_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={styles.chip}
                  aria-pressed={metric === k}
                  data-ph-safe=""
                  onClick={() => {
                    setMetric(k);
                    setValueError(null);
                  }}
                >
                  {METRIC_CATALOGUE[k].label}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className={styles.pair}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={valueId}>
              <span data-ph-safe="">{METRIC_CATALOGUE[metric].label}</span>
            </label>
            <span className={styles.unitBox} data-invalid={valueError ? '' : undefined}>
              <input
                id={valueId}
                className={styles.unitInput}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                value={value}
                aria-invalid={valueError ? true : undefined}
                aria-describedby={[valueError ? valueErrorId : null, hintId].filter(Boolean).join(' ')}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (valueError) setValueError(check(e.target.value));
                }}
                onBlur={() => setValueError(value.trim() === '' ? null : check(value))}
              />
              <span className={styles.unitText} aria-hidden="true">{unit}</span>
            </span>
            {valueError ? <ErrorText id={valueErrorId} code="metric_invalid">{valueError}</ErrorText> : null}
          </div>
          <TextField
            label="Date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => setDateTouched(true)}
            {...(dateError && (dateTouched || date > today) ? { error: errorFromText(dateError, 'field_format') } : {})}
          />
        </div>
        <p id={hintId} className={styles.last}>{lastText}</p>

        {entry || !onAddScan ? null : switching ? (
          <div className={styles.switch} role="group" aria-label="Switch to the scan form">
            <p>The {word} you typed isn’t saved. Open the scan form instead?</p>
            <div className={styles.switchActions}>
              <Button variant="secondary" size="compact" onClick={() => setSwitching(false)} phSafe>Keep editing</Button>
              <Button variant="secondary" size="compact" onClick={() => void toScan()} phSafe>Open scan form</Button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.scanRow} onClick={() => (dirty ? setSwitching(true) : void toScan())}>
            <span className={styles.scanText}>
              <span className={styles.scanTitle}>Add a full InBody scan</span>
              <span className={styles.scanSub}>Logs weight, body fat, muscle mass and more at once</span>
            </span>
            <ChevronIcon direction="right" size={18} />
          </button>
        )}

        {formError ? <ErrorText code={formError.code}>{formError.text}</ErrorText> : null}
      </form>
    </AdaptiveDialog>
  );
}
