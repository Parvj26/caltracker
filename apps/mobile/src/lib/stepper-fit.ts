/** Average width of a digit, as a share of the font size, in the app's bold sans (tabular figures). */
const DIGIT_EM = 0.62;
const MIN_SIZE = 14;
/** The box's border takes this much of its measured width. */
const BORDER_ROOM = 8;

/** Largest font size (up to `max`) at which `chars` characters fit a box `width` pt wide. TextInput has no auto-fit. */
export function fitStepperFont(width: number, chars: number, max: number): number {
  if (width <= 0 || chars <= 0) return max;
  const fit = Math.floor((width - BORDER_ROOM) / (chars * DIGIT_EM));
  return Math.max(MIN_SIZE, Math.min(max, fit));
}
