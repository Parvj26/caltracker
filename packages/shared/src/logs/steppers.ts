// What one press of − or + does to a set's number. Pure, shared by the phone and the dashboard.
import { distanceUnitFor, fromMeters, kgToInput, toKg, toMeters } from '../units/units';
import type { Units } from '../units/units';

export type StepField = 'weight' | 'reps' | 'duration' | 'distance';

const MAX_WEIGHT_KG = 1000;
const MAX_REPS = 1000;
const MAX_DURATION_S = 86400;
const MAX_DISTANCE_M = 1_000_000;
const DURATION_STEP_S = 15;
const DISTANCE_STEP = 0.1;

/**
 * One press of − (-1) or + (1). `current` is in stored units (kg, reps, s, m) and so is the result. Null stays
 * null on −. A press that would pass the highest value the log accepts leaves the number as it is.
 */
export function stepSetValue(field: StepField, current: number | null, direction: 1 | -1, units: Units): number | null {
  if (current === null && direction === -1) return null;
  switch (field) {
    case 'weight': {
      // Step the number the box shows (whole pounds), so a typed 137 lb goes to 142 and back to exactly 137.
      const shown = current === null ? 0 : kgToInput(current, units);
      const next = Math.max(0, shown + direction * (units === 'lb' ? 5 : 2.5));
      const kg = toKg(next, units);
      return kg > MAX_WEIGHT_KG ? current : kg;
    }
    case 'reps': {
      const next = Math.max(0, (current ?? 0) + direction);
      return next > MAX_REPS ? current : next;
    }
    case 'duration': {
      const next = Math.max(0, (current ?? 0) + direction * DURATION_STEP_S);
      return next > MAX_DURATION_S ? current : next;
    }
    case 'distance': {
      const unit = distanceUnitFor(units);
      const shown = current === null ? 0 : fromMeters(current, unit);
      const m = toMeters(Math.max(0, Math.round((shown + direction * DISTANCE_STEP) * 100) / 100), unit);
      return m > MAX_DISTANCE_M ? current : m;
    }
  }
}
