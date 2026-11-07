import { KG_PER_LB, toKg } from '../units/units';
import type { Units } from '../units/units';

export const BUILT_IN_METRIC_KEYS = [
  'weight_kg',
  'body_fat_pct',
  'smm_kg',
  'lbm_kg',
  'bmi',
  'visceral_fat',
  'bmr_kcal',
] as const;
export type BuiltInMetricKey = (typeof BUILT_IN_METRIC_KEYS)[number];

export interface MetricDef {
  label: string;
  /** Unit label for non-mass metrics; mass metrics show kg or lb instead. */
  unit: string;
  /** Mass metrics are stored in kg and shown in the viewer's unit. */
  mass: boolean;
  min: number;
  max: number;
}

export const METRICS: Record<BuiltInMetricKey, MetricDef> = {
  weight_kg: { label: 'Weight', unit: '', mass: true, min: 20, max: 400 },
  body_fat_pct: { label: 'Body fat', unit: '%', mass: false, min: 2, max: 75 },
  smm_kg: { label: 'Skeletal muscle mass', unit: '', mass: true, min: 5, max: 120 },
  lbm_kg: { label: 'Lean body mass', unit: '', mass: true, min: 10, max: 250 },
  bmi: { label: 'BMI', unit: '', mass: false, min: 10, max: 80 },
  visceral_fat: { label: 'Visceral fat level', unit: '', mass: false, min: 1, max: 20 },
  bmr_kcal: { label: 'BMR', unit: 'kcal', mass: false, min: 500, max: 5000 },
};

export interface CustomMetricDef {
  unit_label: string;
  min: number;
  max: number;
}

function isMass(key: string): boolean {
  return Object.hasOwn(METRICS, key) && METRICS[key as BuiltInMetricKey].mass;
}

function r(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * f) / f;
}

/** The number an input box shows: stored kg as is, or lb to 1 decimal. Not for read-only text; use formatMetric. */
export function toInputValue(key: string, value: number, units: Units): number {
  return isMass(key) && units === 'lb' ? r(value / KG_PER_LB, 1) : value;
}

/** Typed value in the viewer's unit to the stored value (kg, 3 decimals for mass). */
export function fromDisplay(key: string, value: number, units: Units): number {
  return isMass(key) ? toKg(value, units) : value;
}

/** The stored value rounded the way it is shown: mass to 1 decimal in kg or lb, whole numbers for visceral fat and BMR. */
export function displayValue(key: string, value: number, units: Units): number {
  if (isMass(key)) return r(units === 'lb' ? r(value / KG_PER_LB, 1) : value, 1);
  if (key === 'visceral_fat' || key === 'bmr_kcal') return r(value, 0);
  if (key === 'body_fat_pct' || key === 'bmi') return r(value, 1);
  return r(value, 2);
}

/** Read-only text for a stored value, e.g. "72.3 kg", "18.2%", "1650 kcal". */
export function formatMetric(key: string, value: number, units: Units, customDef?: CustomMetricDef): string {
  const v = displayValue(key, value, units);
  if (isMass(key)) return `${v} ${units}`;
  if (key === 'body_fat_pct') return `${v.toFixed(1)}%`;
  if (key === 'bmi') return v.toFixed(1);
  if (key === 'visceral_fat') return String(v);
  if (key === 'bmr_kcal') return `${v} kcal`;
  return customDef?.unit_label ? `${v} ${customDef.unit_label}` : String(v);
}

/** Inclusive range check for a built-in or custom metric. Unknown keys are out of range. */
export function isInRange(key: string, value: number, customDef?: { min: number; max: number }): boolean {
  const def = Object.hasOwn(METRICS, key) ? METRICS[key as BuiltInMetricKey] : customDef;
  return def !== undefined && Number.isFinite(value) && value >= def.min && value <= def.max;
}

/** Largest error, in kg, from showing a stored kg value to 1 decimal in lb (plus up to 0.0005 from storing kg to 3 decimals). */
export const MAX_LB_DISPLAY_DRIFT_KG = 0.05 * KG_PER_LB;

/**
 * A body weight typed by a person ("80,5" or " 176.4 ") in their units, as stored kg; or the plain message to show.
 * Used by the client's own weigh-in on the phone.
 */
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
