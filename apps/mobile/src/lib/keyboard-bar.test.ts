import { describe, expect, it } from 'vitest';
import { systemDoneRow } from './keyboard-bar';

const phone = { ios26: true, isPad: false, keyboardHeight: 336, numberPad: true };

describe('systemDoneRow', () => {
  it('sits the bar in iOS 26’s Done row on an iPhone number pad', () => {
    expect(systemDoneRow(phone)).toBe(50);
  });
  it('keeps the bar on the keyboard’s top otherwise', () => {
    expect(systemDoneRow({ ...phone, ios26: false })).toBe(0);
    expect(systemDoneRow({ ...phone, isPad: true })).toBe(0);
    // A hardware keyboard: only a short bar on screen.
    expect(systemDoneRow({ ...phone, keyboardHeight: 55 })).toBe(0);
    // A time box: its keyboard has a return key and no Done row.
    expect(systemDoneRow({ ...phone, numberPad: false })).toBe(0);
  });
});
