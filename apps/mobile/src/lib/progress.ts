// The client's Progress model: scans as read from the server (or the copy saved on the phone) turned into the
// charts and history the screen shows. Pure: no React, no network. Every body rule (units, ranges, change text)
// comes from @caltracker/shared; this file only arranges it.
import {
  BUILT_IN_METRIC_KEYS,
  METRICS,
  bodyOverview,
  changeSince,
  countdownLabel,
  formatMetricChange,
  displayValue,
  formatMetric,
  formatShortDate,
  measurementSeries,
} from '@caltracker/shared';
import { addDays } from '@caltracker/shared';
import type { BuiltInMetricKey, ChartRange, IsoDate, OverviewMetric, Units } from '@caltracker/shared';

export type CustomMetricRow = { id: string; name: string; unit_label: string; min: number; max: number };

export type ScanRow = {
  id: string;
  measuredOn: IsoDate;
  createdAt: string;
  source: 'coach' | 'client';
  /** Path in the private scan-attachments bucket; shown through a signed link made on demand. */
  attachmentPath: string | null;
  /** Stored values: metric key to number (kg for mass). */
  values: Record<string, number>;
};

/** The goal the coach set on the client's Overview (one per client), or null when there is none. */
export type GoalRow = { goal: string; targetDate: IsoDate | null };

export type ProgressRows = { scans: ScanRow[]; customs: CustomMetricRow[]; goal: GoalRow | null };

/** The goal as shown: its words, and, with a date, the countdown ("49 days to go") and the day ("24 Dec"). */
export type GoalModel = { text: string; countdown: string | null; date: string | null };

/** One of the headline numbers (weight, body fat, muscle): its newest value and how it moved over 3 months. */
export type LatestModel = {
  key: OverviewMetric;
  label: string;
  value: string;
  date: string;
  change: string | null;
  /** The 3-month change alone ("−1.5 kg"), for small tiles; null with fewer than two values in that time. */
  delta: string | null;
};

export type ChartModel = {
  key: string;
  title: string;
  points: { date: IsoDate; label: string; value: number; text: string }[];
  change: string | null;
  /** One sentence for VoiceOver: latest value, change and number of points. */
  summary: string;
};

export type HistoryItem = {
  id: string;
  measuredOn: IsoDate;
  date: string;
  values: string[];
  /** The client's own entry: the only kind they may edit or delete. */
  mine: boolean;
  hasPrintout: boolean;
  attachmentPath: string | null;
  /** Stored weight in kg, when the entry has one (to pre-fill the edit box). */
  weightKg: number | null;
};

export type ProgressModel = {
  goal: GoalModel | null;
  latest: LatestModel[];
  charts: ChartModel[];
  hiddenByRange: number;
  history: HistoryItem[];
};

export const customKey = (id: string) => `custom:${id}`;

export function buildProgress(data: ProgressRows, range: ChartRange, units: Units, today: IsoDate): ProgressModel {
  const customByKey = new Map(data.customs.map((c) => [customKey(c.id), c]));
  const keys = [...BUILT_IN_METRIC_KEYS, ...data.customs.map((c) => customKey(c.id))];
  const nameOf = (key: string) =>
    Object.hasOwn(METRICS, key) ? METRICS[key as BuiltInMetricKey].label : (customByKey.get(key)?.name ?? 'Measure');
  const format = (key: string, v: number) => formatMetric(key, v, units, customByKey.get(key));

  const chartsFor = (r: ChartRange): ChartModel[] =>
    keys.flatMap((key) => {
      const rows = data.scans.flatMap((s) =>
        s.values[key] !== undefined ? [{ measured_on: s.measuredOn, value: s.values[key], createdAt: s.createdAt }] : [],
      );
      const series = measurementSeries(rows, r, today);
      if (series.length === 0) return [];
      const last = series[series.length - 1];
      const change = changeSince(series, key, units, today);
      const title = nameOf(key);
      return [
        {
          key,
          title,
          change,
          points: series.map((p) => ({
            date: p.date,
            label: formatShortDate(p.date, today),
            value: displayValue(key, p.value, units),
            text: format(key, p.value),
          })),
          summary: `${title}, ${format(key, last.value)} on ${formatShortDate(last.date, today)}.${change ? ` ${change}.` : ''} ${series.length} points.`,
        },
      ];
    });

  const charts = chartsFor(range);
  const hiddenByRange = range === 'all' ? 0 : chartsFor('all').length - charts.length;

  const withValues = keys.filter((k) => data.scans.some((s) => s.values[k] !== undefined));
  const history = [...data.scans]
    .sort((a, b) => (a.measuredOn === b.measuredOn ? (a.createdAt < b.createdAt ? 1 : -1) : a.measuredOn < b.measuredOn ? 1 : -1))
    .map((s) => ({
      id: s.id,
      measuredOn: s.measuredOn,
      date: formatShortDate(s.measuredOn, today),
      values: withValues.filter((k) => s.values[k] !== undefined).map((k) => `${nameOf(k)} ${format(k, s.values[k])}`),
      mine: s.source === 'client',
      hasPrintout: s.attachmentPath !== null,
      attachmentPath: s.attachmentPath,
      weightKg: s.values.weight_kg ?? null,
    }));

  const goal = data.goal
    ? {
        text: data.goal.goal,
        countdown: data.goal.targetDate ? countdownLabel(data.goal.targetDate, today) : null,
        date: data.goal.targetDate ? formatShortDate(data.goal.targetDate, today) : null,
      }
    : null;

  // The same numbers and 3-month change the coach sees on the client's Overview (shared bodyOverview).
  const latest = bodyOverview(data.scans, '3m', today).flatMap((m): LatestModel[] =>
    m.latest
      ? [
          {
            key: m.key,
            label: METRICS[m.key].label,
            value: format(m.key, m.latest.value),
            date: formatShortDate(m.latest.date, today),
            change:
              m.change === null ? null : `${formatMetricChange(m.key, m.change, units)} since ${formatShortDate(m.points[0].date, today)}`,
            delta: m.change === null ? null : formatMetricChange(m.key, m.change, units),
          },
        ]
      : [],
  );

  return { goal, latest, charts, hiddenByRange, history };
}

/** Saved on the phone so Progress still shows with no signal. */
export function serializeProgress(data: ProgressRows): string {
  return JSON.stringify(data);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The saved copy, or null when missing or not something this version wrote (then it is simply ignored). */
export function parseCachedProgress(raw: string | null): ProgressRows | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || !Array.isArray(v.scans) || !Array.isArray(v.customs)) return null;
  // A copy saved before the goal was kept has no goal field: read it as no goal.
  const goal = v.goal ?? null;
  if (
    goal !== null &&
    !(isObj(goal) && typeof goal.goal === 'string' && (goal.targetDate === null || typeof goal.targetDate === 'string'))
  )
    return null;
  for (const s of v.scans) {
    if (
      !isObj(s) ||
      typeof s.id !== 'string' ||
      typeof s.measuredOn !== 'string' ||
      typeof s.createdAt !== 'string' ||
      (s.source !== 'coach' && s.source !== 'client') ||
      !(s.attachmentPath === null || typeof s.attachmentPath === 'string') ||
      !isObj(s.values) ||
      !Object.values(s.values).every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      return null;
  }
  for (const c of v.customs) {
    if (
      !isObj(c) ||
      typeof c.id !== 'string' ||
      typeof c.name !== 'string' ||
      typeof c.unit_label !== 'string' ||
      typeof c.min !== 'number' ||
      typeof c.max !== 'number'
    )
      return null;
  }
  return { ...(v as unknown as ProgressRows), goal: goal as GoalRow | null };
}


/** Steps the weight entry's date by whole days. Never later than today (no future dates) and never before 2000-01-01, the earliest the database takes. */
export function stepWeightDate(date: IsoDate, days: number, today: IsoDate): IsoDate {
  const next = addDays(date, days);
  if (next > today) return today;
  return next < '2000-01-01' ? date : next;
}
