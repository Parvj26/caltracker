import { describe, expect, it } from 'vitest';
import { updateStatus } from '../../src/index';

describe('updateStatus', () => {
  it('is required when this build is below the minimum', () => {
    expect(updateStatus(3, { minBuild: 4, latestBuild: 4 })).toBe('required');
    expect(updateStatus(1, { minBuild: 4, latestBuild: 5 })).toBe('required');
  });

  it('is ok at or above the minimum', () => {
    expect(updateStatus(4, { minBuild: 4, latestBuild: 4 })).toBe('ok');
    expect(updateStatus(5, { minBuild: 4, latestBuild: 4 })).toBe('ok');
  });

  it('is ok when a newer build exists but is not required', () => {
    expect(updateStatus(3, { minBuild: 3, latestBuild: 4 })).toBe('ok');
  });

  it('is ok when the config is unknown (offline, fetch failed)', () => {
    expect(updateStatus(3, null)).toBe('ok');
  });

  it('is ok when the build number is unknown', () => {
    expect(updateStatus(null, { minBuild: 4, latestBuild: 4 })).toBe('ok');
    expect(updateStatus(Number.NaN, { minBuild: 4, latestBuild: 4 })).toBe('ok');
  });

  it('is ok when minBuild is 0 (nobody blocked)', () => {
    expect(updateStatus(0, { minBuild: 0, latestBuild: 0 })).toBe('ok');
    expect(updateStatus(3, { minBuild: 0, latestBuild: 9 })).toBe('ok');
  });

  it('is ok when the minimum is not a usable number', () => {
    expect(updateStatus(3, { minBuild: Number.NaN, latestBuild: 4 })).toBe('ok');
  });
});
