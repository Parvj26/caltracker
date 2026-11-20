import { KG_PER_LB } from '../units/units';
import type { Units } from '../units/units';

/**
 * The Metrics tab (coach web) and Metrics screen (client app): a fixed list of six body metrics. Values are stored in
 * canonical metric units (kg, %, mL/kg/min, cm, bpm) and shown in each viewer's units: kg or lb for weight and muscle
 * mass, and cm or in for waist (kg → cm, lb → in, the same way distance follows the viewer's weight unit).
 *
 * Keys, ranges and allowed sources mirror the body_metrics table (migration 20261119000100_body_metrics.sql).
 */

export const METRIC_KEYS = ['weight_kg', 'body_fat_pct', 'smm_kg', 'vo2_max', 'waist_cm', 'resting_hr_bpm'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Where a value came from: typed in by hand, an InBody scan, or the client's Apple Health. */
export const METRIC_SOURCES = ['manual', 'inbody_scan', 'apple_health'] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];
export const METRIC_SOURCE_LABELS: Record<MetricSource, string> = {
  manual: 'Logged',
  inbody_scan: 'InBody scan',
  apple_health: 'Apple Health',
};

/** Who entered a value. */
export const METRIC_ENTERED_BY = ['coach', 'client'] as const;
export type MetricEnteredBy = (typeof METRIC_ENTERED_BY)[number];

/** How a metric converts for display. */
export type MetricKind = 'mass' | 'length' | 'percent' | 'vo2' | 'heart_rate';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  /** Longer name where there is room (e.g. "Skeletal muscle mass"). */
  longLabel: string;
  kind: MetricKind;
  /** The stored unit. */
  canonicalUnit: 'kg' | '%' | 'mL/kg/min' | 'cm' | 'bpm';
  /** Decimals shown (in the viewer's unit). */
  decimals: number;
  /** Inclusive stored range. */
  min: number;
  max: number;
  /** Sources a value of this metric can have. */
  sources: readonly MetricSource[];
}

export const METRIC_CATALOGUE: Record<MetricKey, MetricDefinition> = {
  weight_kg: {
    key: 'weight_kg', label: 'Weight', longLabel: 'Weight', kind: 'mass', canonicalUnit: 'kg', decimals: 1,
    min: 20, max: 400, sources: ['manual', 'inbody_scan', 'apple_health'],
  },
  body_fat_pct: {
    key: 'body_fat_pct', label: 'Body fat', longLabel: 'Body fat', kind: 'percent', canonicalUnit: '%', decimals: 1,
    min: 2, max: 75, sources: ['manual', 'inbody_scan', 'apple_health'],
  },
  smm_kg: {
    key: 'smm_kg', label: 'Muscle mass', longLabel: 'Skeletal muscle mass', kind: 'mass', canonicalUnit: 'kg',
    decimals: 1, min: 5, max: 120, sources: ['manual', 'inbody_scan'],
  },
  vo2_max: {
    key: 'vo2_max', label: 'VO2 max', longLabel: 'VO2 max', kind: 'vo2', canonicalUnit: 'mL/kg/min', decimals: 1,
    min: 10, max: 100, sources: ['manual', 'apple_health'],
  },
  waist_cm: {
    key: 'waist_cm', label: 'Waist', longLabel: 'Waist', kind: 'length', canonicalUnit: 'cm', decimals: 1,
    min: 40, max: 250, sources: ['manual', 'apple_health'],
  },
  resting_hr_bpm: {
    key: 'resting_hr_bpm', label: 'Resting heart rate', longLabel: 'Resting heart rate', kind: 'heart_rate',
    canonicalUnit: 'bpm', decimals: 0, min: 25, max: 220, sources: ['manual', 'apple_health'],
  },
};

export const CM_PER_INCH = 2.54;
export type LengthUnit = 'cm' | 'in';

export function isMetricKey(v: unknown): v is MetricKey {
  return typeof v === 'string' && (METRIC_KEYS as readonly string[]).includes(v);
}

export function isMetricSource(v: unknown): v is MetricSource {
  return typeof v === 'string' && (METRIC_SOURCES as readonly string[]).includes(v);
}

/** The viewer's length unit follows their weight unit: kg → cm, lb → in. */
export function lengthUnitFor(units: Units): LengthUnit {
  return units === 'kg' ? 'cm' : 'in';
}

/** The unit label a metric is shown in for this viewer: "kg", "lb", "%", "mL/kg/min", "cm", "in", "bpm". */
export function metricUnit(key: MetricKey, units: Units): string {
  const def = METRIC_CATALOGUE[key];
  if (def.kind === 'mass') return units;
  if (def.kind === 'length') return lengthUnitFor(units);
  return def.canonicalUnit;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
}

/** Stored value in the viewer's unit, unrounded. */
function convert(key: MetricKey, stored: number, units: Units): number {
  const kind = METRIC_CATALOGUE[key].kind;
  if (kind === 'mass' && units === 'lb') return stored / KG_PER_LB;
  if (kind === 'length' && units === 'lb') return stored / CM_PER_INCH;
  return stored;
}

/** A stored value as the number shown to this viewer, rounded to the metric's decimals. */
export function metricToDisplay(key: MetricKey, stored: number, units: Units): number {
  return round(convert(key, stored, units), METRIC_CATALOGUE[key].decimals);
}

/** A number typed in the viewer's unit as the stored value (kg to 3 decimals, cm to 2, others to 2). */
export function metricFromDisplay(key: MetricKey, shown: number, units: Units): number {
  const kind = METRIC_CATALOGUE[key].kind;
  if (kind === 'mass') return round(units === 'lb' ? shown * KG_PER_LB : shown, 3);
  if (kind === 'length') return round(units === 'lb' ? shown * CM_PER_INCH : shown, 2);
  return round(shown, 2);
}

function text(key: MetricKey, n: number): string {
  return n.toFixed(METRIC_CATALOGUE[key].decimals);
}

/** Read-only text for a stored value: "72.3 kg", "159.4 lb", "18.2%", "42.5 mL/kg/min", "32.3 in", "58 bpm". */
export function formatMetricValue(key: MetricKey, stored: number, units: Units): string {
  const shown = text(key, metricToDisplay(key, stored, units));
  return METRIC_CATALOGUE[key].kind === 'percent' ? `${shown}%` : `${shown} ${metricUnit(key, units)}`;
}

/**
 * A change in stored units as text in the viewer's units: "−1.5 kg", "+0.4%", "−3 bpm", or "No change" when it rounds
 * to zero. Converted once from the unrounded difference.
 */
export function formatMetricDelta(key: MetricKey, storedDelta: number, units: Units): string {
  const shown = metricToDisplay(key, storedDelta, units);
  if (shown === 0) return 'No change';
  const body = text(key, Math.abs(shown));
  const unit = METRIC_CATALOGUE[key].kind === 'percent' ? '%' : ` ${metricUnit(key, units)}`;
  return `${shown < 0 ? '−' : '+'}${body}${unit}`;
}

/** The number an edit box shows for a stored value (same as the read-only number, without the unit). */
export const metricInputValue = metricToDisplay;

export type ParsedMetricInput = { ok: true; value: number } | { ok: false; error: string };

/** What a person typed ("80,5", " 176.4 ") in their units, as the stored value; or the plain message to show. */
export function parseMetricInput(key: MetricKey, input: string, units: Units): ParsedMetricInput {
  const def = METRIC_CATALOGUE[key];
  const t = input.trim().replace(',', '.');
  // "the waist", but "the VO2 max" (an abbreviation keeps its capitals).
  const name = /^[A-Z0-9]{2,}/.test(def.label) ? def.label : def.label.toLowerCase();
  if (t === '') return { ok: false, error: `Enter the ${name}.` };
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: `Enter the ${name} as a number.` };
  const value = metricFromDisplay(key, Number(t), units);
  if (value < def.min || value > def.max) {
    // The shown limits are rounded inwards, so typing exactly what the message says is always accepted.
    const f = 10 ** def.decimals;
    const lo = Math.ceil(round(convert(key, def.min, units) * f, 6)) / f;
    const hi = Math.floor(round(convert(key, def.max, units) * f, 6)) / f;
    const unit = def.kind === 'percent' ? '%' : ` ${metricUnit(key, units)}`;
    return { ok: false, error: `Enter a ${name} between ${text(key, lo)} and ${text(key, hi)}${unit}.` };
  }
  return { ok: true, value };
}

/** Inclusive range check for a stored value. */
export function isMetricInRange(key: MetricKey, stored: number): boolean {
  const def = METRIC_CATALOGUE[key];
  return Number.isFinite(stored) && stored >= def.min && stored <= def.max;
}

/** True when a value of this metric can come from this source (e.g. Apple Health has no skeletal muscle mass). */
export function metricAllowsSource(key: MetricKey, source: MetricSource): boolean {
  return METRIC_CATALOGUE[key].sources.includes(source);
}
