// Where a superset box's unit goes (approved SS boards): inside the box ("55 lb each") when the row's numbers and
// units fit, else under it. Decided for the whole row at once, with a little hysteresis, so typing "95" → "100" or a
// re-measure by a point never flips it back and forth. Pure: set-table.tsx measures and draws.

/** Above this text size the unit always goes under the box. */
export const UNIT_INSIDE_MAX_SCALE = 1.15;

/** About how wide a typed number is at the logging boxes' size (18 pt bold): measured ≈ 10.5 pt a character. */
const NUMBER_CHAR = 10.5;
/** About how wide the unit is at 12 pt ("reps each" ≈ 54 pt). */
const UNIT_CHAR = 6;
/** The gap between number and unit, and the box's own padding on both sides. */
const GAP = 3;
const PADDING = 8;
/** How far past the edge it must go before the choice changes. */
const HYSTERESIS = 4;
/** Room kept for a number at least this long: weights get three ("95" → "100" stays put), reps and the rest two. */
const MIN_CHARS = { weight: 3, other: 2 } as const;

/** One box: its number (typed, else the suggestion), its unit, and whether it is a weight. */
export type UnitCell = { value: string; unit: string; weight?: boolean };

const minChars = (cell: UnitCell) => (cell.weight ? MIN_CHARS.weight : MIN_CHARS.other);

/** The width a box needs to hold its number and unit side by side. */
export function insideNeed(cell: UnitCell): number {
  const chars = Math.max(minChars(cell), cell.value.length);
  return chars * NUMBER_CHAR + GAP + cell.unit.length * UNIT_CHAR + PADDING;
}

/** How wide the number's own box is when the unit sits beside it (never wider than what is left). */
export function numberBoxWidth(cell: UnitCell, boxWidth: number): number {
  const left = boxWidth - PADDING - GAP - cell.unit.length * UNIT_CHAR;
  return Math.max(NUMBER_CHAR * 2, Math.min(left, Math.max(minChars(cell), cell.value.length) * NUMBER_CHAR + 6));
}

/**
 * Units inside the row's boxes, or under them. `previous` is the last answer for this row (null the first time):
 * it only changes once the row is clearly over or clearly under the edge.
 */
export function unitsInside(previous: boolean | null, boxWidth: number, cells: readonly UnitCell[], fontScale: number): boolean {
  if (fontScale > UNIT_INSIDE_MAX_SCALE || boxWidth <= 0 || cells.length === 0) return false;
  const need = Math.max(...cells.map(insideNeed));
  if (previous === true) return need <= boxWidth + HYSTERESIS;
  if (previous === false) return need <= boxWidth - HYSTERESIS;
  return need <= boxWidth;
}
