import { CHART_RANGES, CHART_RANGE_LABELS } from '../body/series';
import type { ChartRange, SeriesPoint } from '../body/series';
import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { METRIC_KEYS, isMetricKey, isMetricSource } from './catalogue';
import type { MetricEnteredBy, MetricKey, MetricSource } from './catalogue';

/** The Metrics cards' ranges: 3 months, 1 year, all (the same ranges as the body charts). */
export const METRIC_RANGES = CHART_RANGES;
export type MetricRange = ChartRange;
export const METRIC_RANGE_LABELS = CHART_RANGE_LABELS;
const RANGE_DAYS: Record<MetricRange, number | null> = { '3m': 91, '1y': 365, all: null };

/** Which table a value lives in: new Metrics entries, or an InBody scan / weigh-in in the older body tables. */
export type MetricOrigin = 'body_metrics' | 'body_measurements';

/** One value, as read from the metric_entries view. Stored units (kg, %, mL/kg/min, cm, bpm). */
export interface MetricEntry {
  origin: MetricOrigin;
  /** The body_metrics row, or the body_measurements row (a scan holds several values under one id). */
  id: string;
  metricKey: MetricKey;
  value: number;
  measuredOn: IsoDate;
  /** Exact time when known (Apple Health), else null. */
  measuredAt: string | null;
  createdAt: string;
  source: MetricSource;
  enteredBy: MetricEnteredBy;
  /** Apple Health sample id, else null. */
  externalId: string | null;
}

/** A metric_entries row as the database returns it (every column may be null in a view). */
export interface MetricEntryRow {
  origin: string | null;
  id: string | null;
  metric_key: string | null;
  value: number | string | null;
  measured_on: string | null;
  measured_at: string | null;
  created_at: string | null;
  source: string | null;
  entered_by_role: string | null;
  external_id: string | null;
}

/**
 * A view row as a MetricEntry, or null when the row is incomplete or uses a metric or source this version does not
 * know (so a newer database never breaks an older app; the row is simply left out).
 */
export function toMetricEntry(row: MetricEntryRow): MetricEntry | null {
  const value = row.value === null ? NaN : Number(row.value);
  if (
    (row.origin !== 'body_metrics' && row.origin !== 'body_measurements') ||
    !row.id ||
    !isMetricKey(row.metric_key) ||
    !Number.isFinite(value) ||
    !row.measured_on ||
    !isMetricSource(row.source) ||
    (row.entered_by_role !== 'coach' && row.entered_by_role !== 'client')
  ) {
    return null;
  }
  return {
    origin: row.origin,
    id: row.id,
    metricKey: row.metric_key,
    value,
    measuredOn: row.measured_on,
    measuredAt: row.measured_at,
    createdAt: row.created_at ?? '',
    source: row.source,
    enteredBy: row.entered_by_role,
    externalId: row.external_id,
  };
}

/** Rows to MetricEntry, dropping any that toMetricEntry cannot read. */
export function toMetricEntries(rows: readonly MetricEntryRow[]): MetricEntry[] {
  return rows.flatMap((r) => {
    const e = toMetricEntry(r);
    return e ? [e] : [];
  });
}

/**
 * When one day has several values for a metric, which one the card shows. A value someone entered (by hand or from
 * an InBody scan) beats an Apple Health import of the same day; within the same rank the later one wins (measured
 * time, else when it was saved).
 */
const SOURCE_RANK: Record<MetricSource, number> = { apple_health: 0, inbody_scan: 1, manual: 1 };

function beats(a: MetricEntry, b: MetricEntry): boolean {
  const ra = SOURCE_RANK[a.source];
  const rb = SOURCE_RANK[b.source];
  if (ra !== rb) return ra > rb;
  const ta = a.measuredAt ?? a.createdAt;
  const tb = b.measuredAt ?? b.createdAt;
  return ta >= tb;
}

/** One entry per day for one metric (the one the day shows), oldest first. Entries may come in any order. */
export function metricDailyEntries(entries: readonly MetricEntry[], key: MetricKey): MetricEntry[] {
  const byDate = new Map<IsoDate, MetricEntry>();
  for (const e of entries) {
    if (e.metricKey !== key) continue;
    const have = byDate.get(e.measuredOn);
    if (!have || beats(e, have)) byDate.set(e.measuredOn, e);
  }
  return [...byDate.values()].sort((a, b) => (a.measuredOn < b.measuredOn ? -1 : a.measuredOn > b.measuredOn ? 1 : 0));
}

export interface MetricSummary {
  key: MetricKey;
  /** The latest value of all time (not only the range), or null if never measured. */
  latest: MetricEntry | null;
  /** Latest minus the first value in the range, in stored units; null with fewer than 2 days in the range. */
  change: number | null;
  /** The day the change is measured from (the first value in the range), or null. */
  changeFrom: IsoDate | null;
  /** One point per day in the range, oldest first, for the trend line. */
  points: SeriesPoint[];
}

/** One Metrics card: latest value, change over the range, and its points. */
export function metricSummary(entries: readonly MetricEntry[], key: MetricKey, range: MetricRange, today: IsoDate): MetricSummary {
  const days = RANGE_DAYS[range];
  const from = days === null ? null : addDays(today, -days);
  const daily = metricDailyEntries(entries, key);
  const inRange = from === null ? daily : daily.filter((e) => e.measuredOn >= from);
  const first = inRange[0];
  const last = inRange.at(-1);
  const hasChange = first !== undefined && last !== undefined && inRange.length >= 2;
  return {
    key,
    latest: daily.at(-1) ?? null,
    change: hasChange ? Math.round((last.value - first.value) * 1000) / 1000 : null,
    changeFrom: hasChange ? first.measuredOn : null,
    points: inRange.map((e) => ({ date: e.measuredOn, value: e.value })),
  };
}

/** Every card, in catalogue order. */
export function metricsSummary(entries: readonly MetricEntry[], range: MetricRange, today: IsoDate): MetricSummary[] {
  return METRIC_KEYS.map((key) => metricSummary(entries, key, range, today));
}

/**
 * Who may change or delete an entry from the Metrics screens. The database decides in the end (RLS); this only hides
 * buttons that would be refused. The coach: manual entries a coach made. The client: their own manual entries.
 * Scan values and old weigh-ins (origin body_measurements) are changed where they were made (the scan form, the
 * weigh-in), so they are not editable here. Apple Health imports are changed in Apple Health.
 */
export function canEditMetricEntry(entry: MetricEntry, viewer: MetricEnteredBy): boolean {
  return entry.origin === 'body_metrics' && entry.source === 'manual' && entry.enteredBy === viewer;
}
