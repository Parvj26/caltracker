// The Metrics screen's plumbing that needs no phone: the saved copy, and the Apple Health import batches. Pure, so it
// is unit tested. The numbers on the cards come from metricsSummary in @caltracker/shared.
import { isMetricInRange, isMetricKey, metricAllowsSource, toMetricEntry } from '@caltracker/shared';
import type { IsoDate, MetricEntry, MetricKey } from '@caltracker/shared';

export function serializeMetrics(entries: readonly MetricEntry[]): string {
  return JSON.stringify({ v: 1, entries });
}

/** The saved copy, or null when missing or not something this version wrote. Entries it cannot read are left out. */
export function parseCachedMetrics(raw: string | null): MetricEntry[] | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== 1) return null;
  const entries = (v as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;
  return entries.flatMap((e: unknown) => {
    if (typeof e !== 'object' || e === null) return [];
    const x = e as Record<string, unknown>;
    const str = (k: string) => (typeof x[k] === 'string' ? x[k] : null);
    const parsed = toMetricEntry({
      origin: str('origin'),
      id: str('id'),
      metric_key: str('metricKey'),
      value: typeof x.value === 'number' ? x.value : null,
      measured_on: str('measuredOn'),
      measured_at: str('measuredAt'),
      created_at: str('createdAt'),
      source: str('source'),
      entered_by_role: str('enteredBy'),
      external_id: str('externalId'),
    });
    return parsed ? [parsed] : [];
  });
}

/** One Apple Health sample, already in stored units (kg, %, mL/kg/min, cm, bpm). */
export interface AppleHealthSample {
  /** HealthKit's sample UUID. */
  externalId: string;
  metricKey: MetricKey;
  value: number;
  /** The client's local date of the sample. */
  measuredOn: IsoDate;
  /** ISO time of the sample. */
  measuredAt: string | null;
}

export const APPLE_HEALTH_BATCH = 500;

/**
 * The samples the database will take (a known metric that Apple Health can bring, inside its range, with an id), in
 * batches of at most 500 for sync_apple_health_metrics. Anything else is skipped so one odd reading never stops the
 * whole import.
 */
export function appleHealthBatches(samples: readonly AppleHealthSample[], size = APPLE_HEALTH_BATCH) {
  const rows = samples
    .filter(
      (s) =>
        isMetricKey(s.metricKey) &&
        metricAllowsSource(s.metricKey, 'apple_health') &&
        isMetricInRange(s.metricKey, s.value) &&
        s.externalId.length > 0 &&
        s.externalId.length <= 200 &&
        /^\d{4}-\d{2}-\d{2}$/.test(s.measuredOn),
    )
    .map((s) => ({
      external_id: s.externalId,
      metric_key: s.metricKey,
      value: s.value,
      measured_on: s.measuredOn,
      measured_at: s.measuredAt,
    }));
  const out: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
