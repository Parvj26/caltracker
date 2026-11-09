import { displayValue } from '../body/metrics';
import type { SeriesPoint } from '../body/series';
import { addDays, diffDays } from '../dates/dates';
import type { IsoDate } from '../dates/dates';
import type { OverviewPeriod } from '../body/overview';
import type { Units } from '../units/units';

/**
 * The client's Body screen on Progress: a smoothed weight trend over the single weigh-ins.
 *
 * The trend is an exponentially weighted moving average that respects time: each new weigh-in pulls the trend part of
 * the way towards it, by 1 − 0.5^(days since the last one / half-life). With a 7-day half-life, a weigh-in a week
 * after the last moves the trend half way, one the next day only about a tenth, and one a month later almost all the
 * way. So a day's water swing barely moves the line, while a real change shows within a couple of weeks, however
 * often the client weighs in.
 */

export const WEIGHT_TREND_HALF_LIFE_DAYS = 7;

/** The trend at each weigh-in (`points` oldest first, stored values), rounded to 0.01. */
export function smoothedTrend(points: readonly SeriesPoint[], halfLifeDays = WEIGHT_TREND_HALF_LIFE_DAYS): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let trend = 0;
  points.forEach((p, i) => {
    if (i === 0) trend = p.value;
    else {
      const gap = Math.max(0, diffDays(points[i - 1]!.date, p.date));
      const pull = 1 - 0.5 ** (gap / halfLifeDays);
      trend += pull * (p.value - trend);
    }
    out.push({ date: p.date, value: Math.round(trend * 100) / 100 });
  });
  return out;
}

const PERIOD_DAYS: Record<OverviewPeriod, number | null> = { '4w': 28, '3m': 91, '1y': 365, all: null };

/**
 * The weigh-ins and the trend to draw for a range: the trend is worked out over every weigh-in first and only then cut
 * to the range, so it carries on from before the range instead of starting again at its first dot.
 */
export function weightTrendInRange(
  all: readonly SeriesPoint[],
  period: OverviewPeriod,
  today: IsoDate,
): { raw: SeriesPoint[]; trend: SeriesPoint[] } {
  const days = PERIOD_DAYS[period];
  const from = days === null ? null : addDays(today, -days);
  const keep = (p: SeriesPoint) => from === null || p.date >= from;
  return { raw: all.filter(keep), trend: smoothedTrend(all).filter(keep) };
}

/** Under this change (in the viewer's unit) the trend reads as holding steady. */
const STEADY = 0.5;

/** The chart's text alternative: where the trend went over the range, and how many weigh-ins it is from. */
export function weightTrendSummary(trend: readonly SeriesPoint[], weighIns: number, units: Units, periodLabel: string): string {
  const first = trend[0];
  const last = trend.at(-1);
  if (!first || !last) return 'No weigh-ins in this range yet.';
  const a = displayValue('weight_kg', first.value, units);
  const b = displayValue('weight_kg', last.value, units);
  const direction = Math.abs(b - a) < STEADY ? 'holding steady' : b < a ? 'going down' : 'going up';
  const count = weighIns === 1 ? '1 weigh-in' : `${weighIns} weigh-ins`;
  return `Weight trend, ${periodLabel.toLowerCase()}: from ${a.toFixed(1)} ${units} to ${b.toFixed(1)} ${units}, ${direction}. ${count}.`;
}

/** The Body tile on Progress, from the latest weight (and its 3-month change) as the Body screen shows it. */
export function bodyTile(weight: { value: string; delta: string | null } | null): { value: string; sub: string } {
  if (!weight) return { value: 'Log weight', sub: 'no weigh-ins yet' };
  return { value: weight.value, sub: weight.delta ? `${weight.delta} in 3 months` : 'latest weigh-in' };
}
