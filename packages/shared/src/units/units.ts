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

/** How close (in lb) a stored weight must sit to an exact half pound to count as a half pound someone typed. */
const HALF_LB_TOLERANCE = 0.01;

/**
 * Stored kilograms as pounds: whole pounds, except a half pound someone typed (102.5 lb, stored 46.493 kg)
 * reads back as 102.5. Only a value within 0.01 lb of an exact .5 keeps the half, so a converted 60 kg
 * (132.28 lb) still shows as 132, never 132.5.
 */
function kgToLb(kg: number): number {
  const lb = kg / KG_PER_LB;
  const half = Math.floor(lb) + 0.5;
  return Math.abs(lb - half) <= HALF_LB_TOLERANCE ? half : round(lb, 0);
}

/** Converts stored kilograms to the display unit: whole (or typed half) pounds, or kilograms to 1 decimal. */
export function fromKg(kg: number, unit: Units): number {
  return unit === 'lb' ? kgToLb(kg) : round(kg, 1);
}

/**
 * The number an editable weight box shows. kg: the stored value to 3 decimals, so 61.25 typed stays 61.25.
 * lb: fromKg, so 135 lb (stored 61.235 kg) reads back as 135 and a typed 102.5 lb as 102.5.
 */
export function kgToInput(kg: number, unit: Units): number {
  return unit === 'kg' ? round(kg, 3) : fromKg(kg, unit);
}

/**
 * Thousands grouped with commas ("1,540", "12,345.5"). A regex rather than toLocaleString, so the phone (Hermes) and
 * the dashboard (Workers) always print the same text.
 */
export function groupThousands(text: string): string {
  const [whole = '', fraction] = text.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** One weight in the viewer's units, thousands grouped: "61.2 kg", "135 lb", "1,000 lb". */
export function formatWeight(kg: number, unit: Units): string {
  return `${groupThousands(trim(fromKg(kg, unit), 1))} ${unit}`;
}

/**
 * A total (a workout's volume) in the viewer's units as a whole number, thousands grouped: "1,540 lb", "698 kg".
 * Rounded once, from the unrounded conversion.
 */
export function formatTotalWeight(kg: number, unit: Units): string {
  return `${groupThousands(String(Math.round(unit === 'lb' ? kg / KG_PER_LB : kg)))} ${unit}`;
}

export function distanceUnitFor(units: Units): DistanceUnit {
  return units === 'kg' ? 'km' : 'mi';
}

/** Converts a displayed distance to metres, rounded to 2 decimals. */
export function toMeters(value: number, unit: DistanceUnit): number {
  return round(unit === 'km' ? value * 1000 : value * M_PER_MILE, 2);
}

/** Converts stored metres to km or miles for an input, rounded to 2 decimals. */
export function fromMeters(m: number, unit: DistanceUnit): number {
  return round(unit === 'km' ? m / 1000 : m / M_PER_MILE, 2);
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

/** Seconds as a clock for inputs: '0:45', '1:30', '1:02:05'. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h === 0 ? `${m}:${ss}` : `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

/**
 * Reads a typed clock as seconds. Blank text is null (no value); text it cannot read is NaN.
 * - With a colon: '1:30', '0:45', '1:02:05'. Minutes and seconds after the first part must be below 60.
 * - Digits only, read like a microwave timer (the iPhone number pad has no ':' key): the last two digits are
 *   seconds and anything before them is minutes, so '130' is 1:30, '200' is 2:00 and '1000' is 10:00.
 *   One or two digits are plain seconds: '5' is 0:05, '45' is 0:45 and '90' is 1:30.
 *   Three or more digits whose last two are 60 or more ('190', '1275') are NaN: they could mean several times,
 *   so the box shows them as invalid and nothing is saved rather than guessing.
 */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) {
    if (t.length <= 2) return Number(t);
    const secs = Number(t.slice(-2));
    return secs >= 60 ? NaN : Number(t.slice(0, -2)) * 60 + secs;
  }
  const parts = t.split(':');
  if (parts.length > 3 || !parts.every((p, i) => /^\d*$/.test(p) && (i === 0 ? p !== '' : true))) return NaN;
  const nums = parts.map((p) => (p === '' ? 0 : Number(p)));
  if (nums.slice(1).some((n) => n >= 60)) return NaN;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}
