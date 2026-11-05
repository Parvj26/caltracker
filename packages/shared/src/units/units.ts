export type Units = 'kg' | 'lb';
export type DistanceUnit = 'km' | 'mi';

export const KG_PER_LB = 0.45359237;
export const M_PER_MILE = 1609.344;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

/** Number as text with at most `decimals` places and no trailing zeros. */
function trim(value: number, decimals: number): string {
  return String(round(value, decimals));
}

/** Converts a displayed weight to kilograms, rounded to 3 decimals (numeric(7,3)). */
export function toKg(value: number, unit: Units): number {
  return round(unit === 'lb' ? value * KG_PER_LB : value, 3);
}

/** Converts stored kilograms to the display unit, rounded to 1 decimal. */
export function fromKg(kg: number, unit: Units): number {
  return round(unit === 'lb' ? kg / KG_PER_LB : kg, 1);
}

export function formatWeight(kg: number, unit: Units): string {
  return `${trim(fromKg(kg, unit), 1)} ${unit}`;
}

export function distanceUnitFor(units: Units): DistanceUnit {
  return units === 'kg' ? 'km' : 'mi';
}

/** Converts a displayed distance to metres, rounded to 2 decimals. */
export function toMeters(value: number, unit: DistanceUnit): number {
  return round(unit === 'km' ? value * 1000 : value * M_PER_MILE, 2);
}

export function formatDistance(m: number, units: Units): string {
  if (units === 'kg') {
    return m < 1000 ? `${trim(m, 2)} m` : `${trim(m / 1000, 2)} km`;
  }
  return `${trim(m / M_PER_MILE, 2)} mi`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h === 0) return `${m}:${ss}`;
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}
