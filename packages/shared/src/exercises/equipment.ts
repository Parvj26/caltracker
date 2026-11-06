// Readable names for exercise equipment, for the workout preview's Equipment chips.
// Library exercises use free-exercise-db's lower-case values; a coach's own exercise can hold any wording.

/** Values that mean "nothing to bring": left out of the list. */
const NO_EQUIPMENT = new Set(['body only', 'other', 'none']);

/** free-exercise-db values whose title-cased form reads oddly. Everything else is title-cased. */
const NAMES: Record<string, string> = {
  'e-z curl bar': 'EZ Curl Bar',
  'foam roll': 'Foam Roller',
};

/**
 * The name to show for one exercise's equipment, or null when there is none to show (no value, body weight,
 * "other", "none"). Each word gets a capital first letter; capitals the coach typed are kept ("TRX Straps").
 */
export function equipmentLabel(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\s+/g, ' ');
  const key = value.toLowerCase();
  if (!value || NO_EQUIPMENT.has(key)) return null;
  return NAMES[key] ?? value.replace(/(^|\s)(\S)/g, (_, space: string, first: string) => space + first.toUpperCase());
}

/** The distinct equipment a workout needs, by name, in the order its exercises first use each piece. */
export function workoutEquipment(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const label = equipmentLabel(raw);
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()];
}
