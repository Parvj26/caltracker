import { addDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import { KG_PER_LB } from '../units/units';
import type { Units } from '../units/units';
import { METRICS } from './metrics';
import type { BuiltInMetricKey } from './metrics';
import type { SeriesPoint } from './series';

/**
 * The Body metrics card on the client Overview: the three numbers the trainer reads from InBody (weight, body fat,
 * skeletal muscle mass), their latest value, and how each changed over the chosen period.
 */

export const OVERVIEW_METRICS = ['weight_kg', 'body_fat_pct', 'smm_kg'] as const satisfies readonly BuiltInMetricKey[];
export type OverviewMetric = (typeof OVERVIEW_METRICS)[number];
export const OVERVIEW_PERIODS = ['4w', '3m', '1y', 'all'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];
export const OVERVIEW_PERIOD_LABELS: Record<OverviewPeriod, string> = {
  '4w': 'Last 4 weeks',
  '3m': 'Last 3 months',
  '1y': 'Last year',
  all: 'All time',
};
const PERIOD_DAYS: Record<OverviewPeriod, number | null> = { '4w': 28, '3m': 91, '1y': 365, all: null };

export type OverviewScan = { measuredOn: IsoDate; createdAt: string; values: Record<string, number> };
export type MetricOverview = {
  key: OverviewMetric;
  /** The latest value of all (not just the period), or null if never measured. */
  latest: { date: IsoDate; value: number } | null;
  /** Latest minus the first value in the period, in stored units (kg for mass); null with fewer than 2 in the period. */
  change: number | null;
  /** One value per day in the period, oldest first. */
  points: SeriesPoint[];
};

/** `scans` in any order; a day measured twice keeps the value entered last. */
export function bodyOverview(scans: readonly OverviewScan[], period: OverviewPeriod, today: IsoDate): MetricOverview[] {
  const days = PERIOD_DAYS[period];
  const from = days === null ? null : addDays(today, -days);
  return OVERVIEW_METRICS.map((key) => {
    const byDate = new Map<IsoDate, { value: number; createdAt: string }>();
    for (const s of scans) {
      const value = s.values[key];
      if (value === undefined) continue;
      const have = byDate.get(s.measuredOn);
      if (!have || s.createdAt >= have.createdAt) byDate.set(s.measuredOn, { value, createdAt: s.createdAt });
    }
    const all = [...byDate].map(([date, v]) => ({ date, value: v.value })).sort((a, b) => (a.date < b.date ? -1 : 1));
    const points = from === null ? all : all.filter((p) => p.date >= from);
    const last = all.at(-1) ?? null;
    const change = points.length >= 2 ? points.at(-1)!.value - points[0]!.value : null;
    return { key, latest: last, change, points };
  });
}

/** "−1.5 kg", "+0.4%", "No change": a change in stored units, shown in the viewer's units to 1 decimal. */
export function formatMetricChange(key: OverviewMetric, change: number, units: Units): string {
  const mass = METRICS[key].mass;
  const shown = Math.round((mass && units === 'lb' ? change / KG_PER_LB : change) * 10) / 10;
  if (shown === 0) return 'No change';
  const unit = mass ? ` ${units}` : METRICS[key].unit;
  return `${shown < 0 ? '−' : '+'}${Math.abs(shown)}${unit}`;
}
