import { describe, expect, it } from 'vitest';
import { REST_PICKS, activeRestPick, restPickLabel, restPicksShown } from './rest-picks';

describe('Rest quick picks', () => {
  it('offers 0:30, 1:00, 1:30 and 2:00', () => {
    expect(REST_PICKS.map(restPickLabel)).toEqual(['0:30', '1:00', '1:30', '2:00']);
  });

  it('marks the pick that matches the rest, and none otherwise', () => {
    expect(activeRestPick(90)).toBe(90);
    expect(activeRestPick(130)).toBeNull();
    expect(activeRestPick(0)).toBeNull();
    expect(activeRestPick(null)).toBeNull();
  });

  it('shows only while the Rest box has focus', () => {
    expect(restPicksShown({ focused: true, hasRestBox: true })).toBe(true);
    expect(restPicksShown({ focused: false, hasRestBox: true })).toBe(false);
    expect(restPicksShown({ focused: true, hasRestBox: false })).toBe(false);
  });
});
