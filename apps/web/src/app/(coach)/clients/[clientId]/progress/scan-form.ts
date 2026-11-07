import { BUILT_IN_METRIC_KEYS, METRICS, fromDisplay, isInRange, toInputValue } from '@caltracker/shared';
import type { BuiltInMetricKey, Units } from '@caltracker/shared';

export type CustomMetric = { id: string; name: string; unit_label: string; min: number; max: number; archived_at: string | null };

export type ScanField = { key: string; label: string };

export const customKey = (id: string) => `custom:${id}`;

const customLabel = (c: Pick<CustomMetric, 'name' | 'unit_label'>) => (c.unit_label ? `${c.name} (${c.unit_label})` : c.name);

function builtInLabel(key: BuiltInMetricKey, units: Units): string {
  const def = METRICS[key];
  if (def.mass) return `${def.label} (${units})`;
  if (def.unit) return `${def.label} (${def.unit})`;
  return def.label;
}

/**
 * The fields of the scan form, in order: the standard measures, then the workspace's custom ones. An archived custom
 * measure is listed only when the scan being edited already has a value for it.
 */
export function scanFields(customs: ReadonlyArray<CustomMetric>, units: Units, keepArchived: ReadonlySet<string> = new Set()): ScanField[] {
  return [
    ...BUILT_IN_METRIC_KEYS.map((key) => ({ key, label: builtInLabel(key, units) })),
    ...customs
      .filter((c) => c.archived_at === null || keepArchived.has(customKey(c.id)))
      .map((c) => ({ key: customKey(c.id), label: customLabel(c) })),
  ];
}

/** Text for the input boxes of a saved scan (stored values shown in the coach's units). */
export function inputsFor(values: Readonly<Record<string, number>>, units: Units): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, v]) => [key, String(toInputValue(key, v, units))]));
}

export type ScanParse =
  | { ok: true; values: Record<string, number> }
  | { ok: false; errors: Record<string, string>; form?: string };

/**
 * Turns what was typed (in the coach's units) into stored values. Blank boxes are left out. A box left exactly as
 * the edit started keeps its stored value, so saving an edit does not nudge numbers through the lb rounding.
 */
export function parseScanForm(
  inputs: Readonly<Record<string, string>>,
  fields: ReadonlyArray<ScanField>,
  customs: ReadonlyArray<CustomMetric>,
  units: Units,
  original?: { values: Readonly<Record<string, number>>; inputs: Readonly<Record<string, string>> },
): ScanParse {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const { key, label } of fields) {
    const text = (inputs[key] ?? '').trim();
    if (text === '') continue;
    const kept = original?.values[key];
    if (kept !== undefined && original?.inputs[key] === text) {
      values[key] = kept;
      continue;
    }
    const typed = Number(text);
    if (!Number.isFinite(typed)) {
      errors[key] = `${label}: enter a number.`;
      continue;
    }
    const stored = fromDisplay(key, typed, units);
    const custom = key.startsWith('custom:') ? customs.find((c) => customKey(c.id) === key) : undefined;
    if (!isInRange(key, stored, custom)) {
      const def = custom ?? (Object.hasOwn(METRICS, key) ? METRICS[key as BuiltInMetricKey] : undefined);
      const range = def ? `${shown(key, def.min, units)} and ${shown(key, def.max, units)}` : 'the allowed range';
      errors[key] = `${label} must be between ${range}.`;
      continue;
    }
    values[key] = stored;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(values).length === 0) return { ok: false, errors: {}, form: 'Enter at least one value.' };
  return { ok: true, values };
}

/** A range end the way the form shows it, without a unit label (the field label already has it). */
const shown = (key: string, value: number, units: Units): string => String(toInputValue(key, value, units));

export const PRINTOUT_ERROR = 'Printouts must be an image or a PDF under 5 MB.';
export const MAX_PRINTOUT_BYTES = 5 * 1024 * 1024;
