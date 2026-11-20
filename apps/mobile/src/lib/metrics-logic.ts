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
/** Apple Health ids per delete request (they go in the request address). */
export const DELETE_CHUNK = 100;

/** `items` in groups of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date that exists (not 2026-02-30). */
function isRealDate(d: string): boolean {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** Today's UTC date plus one day (the latest date the database takes), as YYYY-MM-DD. */
function latestDate(now: Date): string {
  return new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** The UTC date of an ISO time, as the database reads it ("2026-11-19T01:00:00+05:00" is 2026-11-18), or "" if unreadable. */
function utcDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/**
 * The samples the database will take, in batches of at most 500 for sync_apple_health_metrics: a known metric that
 * Apple Health can bring, inside its range, with an id, dated from 2000-01-01 to tomorrow (UTC), and a time no more
 * than a day ahead and within a day of its date (as the database checks). The same id twice keeps the later one.
 * Anything else is skipped, so one odd reading never stops a whole batch.
 */
export function appleHealthBatches(samples: readonly AppleHealthSample[], now = new Date(), size = APPLE_HEALTH_BATCH) {
  const maxDate = latestDate(now);
  const maxTime = now.getTime() + 86_400_000;
  const byId = new Map<string, AppleHealthSample>();
  for (const s of samples) {
    if (
      !isMetricKey(s.metricKey) ||
      !metricAllowsSource(s.metricKey, 'apple_health') ||
      !isMetricInRange(s.metricKey, s.value) ||
      s.externalId.length === 0 ||
      s.externalId.length > 200 ||
      !DATE.test(s.measuredOn) ||
      !isRealDate(s.measuredOn) ||
      s.measuredOn < '2000-01-01' ||
      s.measuredOn > maxDate ||
      (s.measuredAt !== null &&
        !(Date.parse(s.measuredAt) <= maxTime &&
          Math.abs(Date.parse(utcDate(s.measuredAt)) - Date.parse(s.measuredOn)) <= 86_400_000))
    ) {
      continue;
    }
    byId.delete(s.externalId); // keep the later copy, in its later position
    byId.set(s.externalId, s);
  }
  const rows = [...byId.values()].map((s) => ({
    external_id: s.externalId,
    metric_key: s.metricKey,
    value: s.value,
    measured_on: s.measuredOn,
    measured_at: s.measuredAt,
  }));
  return chunk(rows, size);
}
