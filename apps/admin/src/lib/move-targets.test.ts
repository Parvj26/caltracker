import { describe, expect, it } from 'vitest';
import { moveTargets } from './move-targets';

describe('moveTargets', () => {
  it('lists each workspace once, under its owner, without the current one', () => {
    const rows = [
      { user_id: 's', name: 'Sue Staff', workspace_id: 'w1', workspace_name: 'Gym One', role: 'staff' },
      { user_id: 'o', name: 'Olga Owner', workspace_id: 'w1', workspace_name: 'Gym One', role: 'owner' },
      { user_id: 'b', name: 'Ben', workspace_id: 'w2', workspace_name: 'Ben Fit', role: 'owner' },
      { user_id: 'c', name: 'Cur', workspace_id: 'w3', workspace_name: 'Current', role: 'owner' },
    ];
    expect(moveTargets(rows, 'w3')).toEqual([
      { workspace_id: 'w2', label: 'Ben · Ben Fit' },
      { workspace_id: 'w1', label: 'Olga Owner · Gym One' },
    ]);
  });
});
