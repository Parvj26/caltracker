import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';

export const CHART_RANGES = ['3m', '1y', 'all'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export const CHART_RANGE_LABELS: Record<ChartRange, string> = { '3m': '3 months', '1y': '1 year', all: 'All' };
const RANGE_DAYS: Record<ChartRange, number | null> = { '3m': 91, '1y': 365, all: null };

export interface SeriesPoint {
  date: IsoDate;
  value: number;
}

/** Points for one metric, oldest first, within the range. Fewer than 2 points gives [] (no chart). */
export function measurementSeries(
  rows: ReadonlyArray<{ measured_on: IsoDate; value: number }>,
  range: ChartRange,
  today: IsoDate,
): SeriesPoint[] {
  const days = RANGE_DAYS[range];
  const from = days === null ? null : addDays(today, -days);
  const points = rows
    .filter((r) => from === null || r.measured_on >= from)
    .map((r) => ({ date: r.measured_on, value: r.value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points.length >= 2 ? points : [];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct", or "6 Oct 2025" when not in the current year. Same output as en-GB short month, without depending on ICU. */
export function formatShortDate(d: IsoDate, today: IsoDate): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const base = `${day} ${MONTHS[m - 1]}`;
  return d.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${y}`;
}

/** Change from the previous point to the latest, e.g. "−1.4 since 6 Oct". Null with fewer than 2 points. */
export function changeSince(series: ReadonlyArray<SeriesPoint>, today: IsoDate): string | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2]!;
  const last = series[series.length - 1]!;
  const diff = Math.round((last.value - prev.value) * 10) / 10;
  const when = formatShortDate(prev.date, today);
  if (diff === 0) return `No change since ${when}`;
  return `${diff < 0 ? '−' : '+'}${Math.abs(diff)} since ${when}`;
}
