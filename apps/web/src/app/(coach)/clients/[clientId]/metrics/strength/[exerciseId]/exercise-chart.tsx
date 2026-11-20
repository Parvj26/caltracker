'use client';

import { addDays, diffDays, formatWeight, shortDate, type HeaviestChartPoint, type Units } from '@caltracker/shared';
import { LineChart } from '@/components/charts/line-chart';

const EPOCH = '2000-01-01';

/**
 * The exercise's chart: the heaviest weight per session (solid) and the estimated 1-rep max (dashed, where there is
 * one). A client component because the chart's axis labels are functions.
 */
export function ExerciseChart({ name, points, summary, units }: { name: string; points: readonly HeaviestChartPoint[]; summary: string; units: Units }) {
  const hasE1rm = points.some((p) => p.e1rmKg !== null);
  return (
    <LineChart
      title={`${name}, heaviest weight per session${hasE1rm ? ' and estimated 1-rep max' : ''}`}
      name="Heaviest weight"
      points={points.map((p) => ({ x: diffDays(EPOCH, p.date), y: p.heaviestKg, label: p.label }))}
      secondary={hasE1rm ? { name: 'Estimated 1-rep max', values: points.map((p) => p.e1rmKg) } : undefined}
      summary={summary}
      yLabel={(y) => formatWeight(y, units)}
      xLabel={(x) => shortDate(addDays(EPOCH, x))}
    />
  );
}
