// What the client's Metrics screen and the Progress tile show, from the Metrics entries. Pure, so it is unit tested.
// Numbers and units come from @caltracker/shared (metricSummary, formatMetricValue, metricToDisplay).
import {
  METRIC_CATALOGUE,
  METRIC_KEYS,
  canEditMetricEntry,
  formatMetricDelta,
  formatMetricValue,
  formatShortDate,
  metricDailyEntries,
  metricSummary,
  metricToDisplay,
  metricUnit,
  type IsoDate,
  type MetricEntry,
  type MetricKey,
  type MetricRange,
  type Units,
} from '@caltracker/shared';
import type { SeriesPoint } from '@caltracker/shared';

/** Where a value came from, in the client's words: "logged by you", "logged by Luis", "InBody scan", "from Apple Health". */
export function metricSourceLabel(entry: MetricEntry, coachFirstName: string | null): string {
  if (entry.source === 'apple_health') return 'from Apple Health';
  if (entry.source === 'inbody_scan') return 'InBody scan';
  return entry.enteredBy === 'client' ? 'logged by you' : `logged by ${coachFirstName ?? 'your coach'}`;
}

/**
 * How the client may change an entry here: 'metric' (their own Metrics entry), 'weighin' (a weight they logged before
 * Metrics, kept in the older body table), or null (their coach's, a scan, or Apple Health's).
 */
export function clientEditKind(entry: MetricEntry): 'metric' | 'weighin' | null {
  if (canEditMetricEntry(entry, 'client')) return 'metric';
  if (entry.origin === 'body_measurements' && entry.source === 'manual' && entry.enteredBy === 'client' && entry.metricKey === 'weight_kg') {
    return 'weighin';
  }
  return null;
}

/** The value as the number and unit shown separately ("72.3", "kg"; "18.2", "%"). */
export function metricParts(key: MetricKey, stored: number, units: Units): { value: string; unit: string } {
  return { value: metricToDisplay(key, stored, units).toFixed(METRIC_CATALOGUE[key].decimals), unit: metricUnit(key, units) };
}

export interface MetricRow {
  key: MetricKey;
  label: string;
  /** "72.3", or "" with nothing logged (the row then says "Not logged yet" instead). */
  value: string;
  unit: string;
  /** "12 Nov · InBody scan", or "Not logged yet". */
  meta: string;
  /** "−1.5 kg" over the range, or null. */
  change: string | null;
  /** The trend line's points in the range, oldest first (stored units). */
  points: SeriesPoint[];
  latest: MetricEntry | null;
}

/** One row per metric, in catalogue order. "Latest" is the newest value at all; change and line follow the range. */
export function metricRows(
  entries: readonly MetricEntry[],
  range: MetricRange,
  units: Units,
  today: IsoDate,
  coachFirstName: string | null,
): MetricRow[] {
  return METRIC_KEYS.map((key) => {
    const latest = metricDailyEntries(entries, key).at(-1) ?? null;
    const summary = metricSummary(entries, key, range, today);
    const parts = latest ? metricParts(key, latest.value, units) : { value: '', unit: metricUnit(key, units) };
    return {
      key,
      label: METRIC_CATALOGUE[key].label,
      ...parts,
      meta: latest ? `${dayLabel(latest.measuredOn, today)} · ${metricSourceLabel(latest, coachFirstName)}` : 'Not logged yet',
      change: summary.change === null ? null : formatMetricDelta(key, summary.change, units),
      points: summary.points,
      latest,
    };
  });
}

function dayLabel(date: IsoDate, today: IsoDate): string {
  return date === today ? 'Today' : formatShortDate(date, today);
}

/** Every entry of one metric, newest first (several on one day all show, so each can be changed). */
export function metricHistory(entries: readonly MetricEntry[], key: MetricKey): MetricEntry[] {
  return entries
    .filter((e) => e.metricKey === key)
    .sort((a, b) =>
      a.measuredOn !== b.measuredOn
        ? a.measuredOn < b.measuredOn ? 1 : -1
        : (b.measuredAt ?? b.createdAt).localeCompare(a.measuredAt ?? a.createdAt),
    );
}

/** A row's entries other than the latest one (which the row itself shows), newest first. */
export function earlierEntries(entries: readonly MetricEntry[], key: MetricKey, latest: MetricEntry | null): MetricEntry[] {
  return metricHistory(entries, key).filter((e) => !latest || e.origin !== latest.origin || e.id !== latest.id || e.metricKey !== latest.metricKey);
}

/** The log sheet's hint: "Last: 70.5 kg on 12 Nov (InBody scan)", or null with nothing logged. */
export function lastValueLine(entries: readonly MetricEntry[], key: MetricKey, units: Units, today: IsoDate, coachFirstName: string | null): string | null {
  const last = metricDailyEntries(entries, key).at(-1);
  if (!last) return null;
  return `Last: ${formatMetricValue(key, last.value, units)} on ${formatShortDate(last.measuredOn, today)} (${metricSourceLabel(last, coachFirstName)})`;
}

/** The Progress tab's Metrics row: the latest weight, then "Weight · −2.1 kg in 3 months · from Apple Health". */
export function metricsTile(entries: readonly MetricEntry[], units: Units, today: IsoDate): { value: string; sub: string } {
  const latest = metricDailyEntries(entries, 'weight_kg').at(-1);
  if (!latest) return { value: 'Log a metric', sub: 'No weigh-ins yet' };
  const { change } = metricSummary(entries, 'weight_kg', '3m', today);
  return {
    value: formatMetricValue('weight_kg', latest.value, units),
    sub: ['Weight', change === null ? 'latest weigh-in' : `${formatMetricDelta('weight_kg', change, units)} in 3 months`, latest.source === 'apple_health' ? 'from Apple Health' : null]
      .filter(Boolean)
      .join(' · '),
  };
}

/** The sparkline's points scaled into a w×h box (with `pad` around), as "x,y x,y". Empty below 2 points. */
export function sparklinePoints(points: readonly SeriesPoint[], w: number, h: number, pad = 2): string {
  if (points.length < 2) return '';
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  return points
    .map((p, i) => {
      const x = pad + (i * (w - 2 * pad)) / (points.length - 1);
      const y = hi === lo ? h / 2 : pad + ((hi - p.value) * (h - 2 * pad)) / span;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}
