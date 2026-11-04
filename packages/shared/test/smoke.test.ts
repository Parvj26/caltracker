import { describe, expect, it } from 'vitest';
import * as shared from '../src';

describe('@caltracker/shared', () => {
  it('resolves the package entry point', () => {
    expect(typeof shared).toBe('object');
  });
});
