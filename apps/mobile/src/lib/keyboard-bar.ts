// Where the ‹ › bar above the number pad sits (set-table.tsx draws it). Pure.

/** iOS 26's Done row at the top of an on-screen number pad's frame: 50 pt (measured on the iOS 26 simulator). */
const SYSTEM_DONE_ROW = 50;
/** Shorter than this, the keyboard frame is no on-screen pad (a hardware keyboard's bar, for one). */
const ON_SCREEN_PAD_MIN = 200;

/**
 * iOS 26's Done floats in a clear row at the top of an iPhone number pad's frame. The bar sits down in that row, so
 * ‹ › and Done share one line (approved Logger board) instead of Done hanging under the bar. Only then: iOS 26 or
 * later, an iPhone (the iPad's keyboard has its own hide key), a real on-screen keypad, and a number pad (a time box's
 * keyboard has a return key and no Done row). Otherwise the bar sits on the keyboard's top, as before.
 */
export function systemDoneRow(o: { ios26: boolean; isPad: boolean; keyboardHeight: number; numberPad: boolean }): number {
  return o.ios26 && !o.isPad && o.numberPad && o.keyboardHeight > ON_SCREEN_PAD_MIN ? SYSTEM_DONE_ROW : 0;
}
