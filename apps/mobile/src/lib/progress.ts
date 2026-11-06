// The client's Progress model: scans as read from the server (or the copy saved on the phone) turned into the
// charts and history the screen shows. Pure: no React, no network. Every body rule (units, ranges, change text)
// comes from @caltracker/shared; this file only arranges it.
import {
  BUILT_IN_METRIC_KEYS,
  METRICS,
  changeSince,
  displayValue,
  formatMetric,
  formatShortDate,
  fromDisplay,
  isInRange,
  toInputValue,
  measurementSeries,
} from '@caltracker/shared';
import { addDays } from '@caltracker/shared';
import type { BuiltInMetricKey, ChartRange, IsoDate, Units } from '@caltracker/shared';

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

export type ProgressRows = { scans: ScanRow[]; customs: CustomMetricRow[] };

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

export type ProgressModel = { charts: ChartModel[]; hiddenByRange: number; history: HistoryItem[] };

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

  return { charts, hiddenByRange, history };
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
  return v as unknown as ProgressRows;
}

/** A typed weight (in the viewer's unit, comma or dot) to the stored kg, or a plain message. */
export function parseWeightInput(text: string, units: Units): { ok: true; kg: number } | { ok: false; error: string } {
  const t = text.trim().replace(',', '.');
  if (t === '') return { ok: false, error: 'Enter your weight.' };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: 'Enter your weight as a number.' };
  const kg = fromDisplay('weight_kg', Number(t), units);
  if (!isInRange('weight_kg', kg)) {
    const { min, max } = METRICS.weight_kg;
    return { ok: false, error: `Enter a weight between ${toInputValue('weight_kg', min, units)} and ${toInputValue('weight_kg', max, units)} ${units}.` };
  }
  return { ok: true, kg };
}

/** Steps the weight entry's date by whole days. Never later than today (no future dates) and never before 2000-01-01, the earliest the database takes. */
export function stepWeightDate(date: IsoDate, days: number, today: IsoDate): IsoDate {
  const next = addDays(date, days);
  if (next > today) return today;
  return next < '2000-01-01' ? date : next;
}
