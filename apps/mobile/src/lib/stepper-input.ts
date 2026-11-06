import { toKg, toMeters, type StepField, type Units } from '@caltracker/shared';
import { parseActualInput } from './active-log-logic';

const MAX_KG = 1000;
const MAX_M = 1_000_000;

/**
 * What a stepper's typed text means in stored units (kg, reps, seconds, metres): a number, null when cleared,
 * or undefined when the text can't be used yet (keep the draft, save nothing). `unit` is the stepper's unit label.
 */
export function typedToStored(field: StepField, unit: string, text: string): number | null | undefined {
  const v = parseActualInput(text, field);
  if (v === undefined || v === null) return v;
  if (field === 'weight') {
    const kg = toKg(v, unit as Units);
    return kg <= MAX_KG ? kg : undefined;
  }
  if (field === 'distance') {
    const m = toMeters(v, unit as 'mi' | 'km');
    return m <= MAX_M ? m : undefined;
  }
  return v;
}
