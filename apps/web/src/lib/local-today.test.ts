import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msUntilNextLocalMidnight, subscribeToDayChange } from './local-today';

// "Today" in the coach's browser must roll over at local midnight, and be rechecked when a sleeping tab comes back.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', new EventTarget());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('msUntilNextLocalMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 5, 23, 59, 0))).toBe(60_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 10, 5, 0, 0, 0))).toBe(24 * 3_600_000);
  });
});

describe('subscribeToDayChange', () => {
  it('fires just after each local midnight', () => {
    vi.setSystemTime(new Date(2026, 10, 5, 23, 59, 0));
    const onChange = vi.fn();
    const stop = subscribeToDayChange(onChange);
    vi.advanceTimersByTime(59_000);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(48 * 3_600_000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('rechecks when the tab becomes visible or gets focus (timers may not run while asleep)', () => {
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
    const onChange = vi.fn();
    const stop = subscribeToDayChange(onChange);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    window.dispatchEvent(new Event('focus'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
