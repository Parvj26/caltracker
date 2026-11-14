import { describe, expect, it } from 'vitest';
import { searchScope } from './search-scope';

describe('searchScope', () => {
  it('follows the picked chip while the search box is empty', () => {
    expect(searchScope('active', '')).toEqual({ clientFilter: 'active', invites: false });
    expect(searchScope('missed', '  ')).toEqual({ clientFilter: 'missed', invites: false });
    expect(searchScope('invited', '')).toEqual({ clientFilter: null, invites: true });
  });

  it('searches every client and invite once something is typed, whatever chip is picked', () => {
    for (const chip of ['active', 'missed', 'plan_ending', 'nothing_planned', 'invited'] as const) {
      expect(searchScope(chip, 'ivy')).toEqual({ clientFilter: 'active', invites: true });
    }
  });
});
