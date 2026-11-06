import { KG_PER_LB, fromKg, toKg } from '../units/units';
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

function isMass(key: string): boolean {
  return key in METRICS && METRICS[key as BuiltInMetricKey].mass;
}

/** Stored value to the viewer's unit. kg is shown as stored (no rounding). Mass is shown to 1 decimal in lb (body metrics need that, unlike lifting weights). */
export function toDisplay(key: string, value: number, units: Units): number {
  return isMass(key) && units === 'lb' ? fromKg(value, 'lb') : value;
}

/** Typed value in the viewer's unit to the stored value (kg, 3 decimals for mass). */
export function fromDisplay(key: string, value: number, units: Units): number {
  return isMass(key) ? toKg(value, units) : value;
}

/** Largest error, in kg, from showing a stored kg value to 1 decimal in lb. */
export const MAX_LB_DISPLAY_DRIFT_KG = 0.05 * KG_PER_LB;
