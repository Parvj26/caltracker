import { describe, expect, it } from 'vitest';
import { zooHref } from './zoo-href';

describe('zooHref', () => {
  it('opens the Zoo book screen (no longer a tab)', () => {
    expect(zooHref()).toBe('/zoo');
  });
});
