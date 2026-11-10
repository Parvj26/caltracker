import { describe, expect, it, vi } from 'vitest';
import {
  UPDATE_GATE_COPY,
  UPDATE_STEPS,
  checkForUpdate,
  fetchUpdateConfig,
  parseBuild,
  updateFooter,
  type UpdateConfigSource,
} from './update-gate';

const row = { ios_min_build: 4, ios_latest_build: 5, ios_update_url: 'https://testflight.apple.com/join/abc' };
const source = (result: { data: unknown; error: unknown } | Error): UpdateConfigSource => ({
  read: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
});

describe('parseBuild', () => {
  it('reads the native build number', () => {
    expect(parseBuild('3')).toBe(3);
    expect(parseBuild(' 12 ')).toBe(12);
  });
  it('is null when the build is missing or not a whole number', () => {
    expect(parseBuild(null)).toBeNull();
    expect(parseBuild(undefined)).toBeNull();
    expect(parseBuild('')).toBeNull();
    expect(parseBuild('1.2')).toBeNull();
    expect(parseBuild('abc')).toBeNull();
  });
});

describe('fetchUpdateConfig', () => {
  it('maps the app_config row', async () => {
    await expect(fetchUpdateConfig(source({ data: row, error: null }))).resolves.toEqual({
      minBuild: 4,
      latestBuild: 5,
      updateUrl: 'https://testflight.apple.com/join/abc',
    });
  });
  it('is null on an error, no row, a bad row or a network failure (never block)', async () => {
    await expect(fetchUpdateConfig(source({ data: null, error: { message: 'x' } }))).resolves.toBeNull();
    await expect(fetchUpdateConfig(source({ data: null, error: null }))).resolves.toBeNull();
    await expect(fetchUpdateConfig(source({ data: { ios_min_build: 'x' }, error: null }))).resolves.toBeNull();
    await expect(fetchUpdateConfig(source(new TypeError('Network request failed')))).resolves.toBeNull();
  });
  it('is null when the read never answers in time', async () => {
    vi.useFakeTimers();
    const pending = fetchUpdateConfig({ read: () => new Promise(() => undefined) }, 1000);
    vi.advanceTimersByTime(1000);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe('checkForUpdate', () => {
  it('is required when this build is below the minimum', async () => {
    await expect(checkForUpdate(source({ data: row, error: null }), '3')).resolves.toEqual({
      status: 'required',
      config: { minBuild: 4, latestBuild: 5, updateUrl: 'https://testflight.apple.com/join/abc' },
    });
  });
  it('is ok at the minimum', async () => {
    await expect(checkForUpdate(source({ data: row, error: null }), '4')).resolves.toMatchObject({ status: 'ok' });
  });
  it('is ok when offline or the build is unknown', async () => {
    await expect(checkForUpdate(source(new Error('offline')), '1')).resolves.toEqual({ status: 'ok', config: null });
    await expect(checkForUpdate(source({ data: row, error: null }), null)).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('updateFooter', () => {
  it('shows this version, the newest build and the tip', () => {
    expect(updateFooter('1.0.0', '3', 4)).toBe('Version 1.0.0 (3) · Newest (4) · Tip: turn on Automatic Updates in TestFlight');
  });
  it('leaves out Newest when it is unknown', () => {
    expect(updateFooter('1.0.0', '3', 0)).toBe('Version 1.0.0 (3) · Tip: turn on Automatic Updates in TestFlight');
  });
});

describe('screen copy', () => {
  it('matches the approved board', () => {
    expect(UPDATE_GATE_COPY).toEqual({
      eyebrow: 'NEW VERSION READY',
      headline: 'Let’s get you\nup to date',
      body: 'This version is out of date. Update to keep logging your workouts with your coach.',
      button: 'Open TestFlight',
    });
    expect(UPDATE_STEPS).toEqual([
      { title: 'Open TestFlight', detail: 'Tap the button below' },
      { title: 'Tap Update', detail: 'Next to CalTracker Coaching' },
      { title: 'Come back here', detail: 'You’ll pick up right where you left off' },
    ]);
  });
});
