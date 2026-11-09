import { describe, expect, it, vi } from 'vitest';
import { publishUnits, subscribeUnits } from './units-bus';

describe('units bus', () => {
  it('tells every listener when the units change', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeUnits(a);
    const offB = subscribeUnits(b);
    publishUnits('u1', 'kg');
    expect(a).toHaveBeenCalledWith('u1', 'kg');
    expect(b).toHaveBeenCalledWith('u1', 'kg');
    offA();
    offB();
  });
  it('stops telling a listener after it unsubscribes', () => {
    const a = vi.fn();
    const off = subscribeUnits(a);
    off();
    publishUnits('u1', 'lb');
    expect(a).not.toHaveBeenCalled();
  });
});
