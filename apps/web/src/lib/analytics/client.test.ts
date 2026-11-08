import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('posthog-js');
});

describe('track (web)', () => {
  it('does nothing without a key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const capture = vi.fn();
    vi.doMock('posthog-js', () => ({ default: { capture, init: vi.fn() } }));
    const { track } = await import('./client');
    track('app_opened');
    expect(capture).not.toHaveBeenCalled();
  });

  it('never throws when PostHog throws', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.doMock('posthog-js', () => ({
      default: {
        init: vi.fn(),
        capture: () => {
          throw new Error('boom');
        },
      },
    }));
    const { initAnalytics, track } = await import('./client');
    initAnalytics();
    expect(() => track('app_opened')).not.toThrow();
  });

  it('sends sanitized properties', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    const capture = vi.fn();
    vi.doMock('posthog-js', () => ({ default: { capture, init: vi.fn() } }));
    const { initAnalytics, track } = await import('./client');
    initAnalytics();
    track('error_shown', { code: 'save_failed', message: 'Maya 80kg' });
    expect(capture).toHaveBeenCalledWith('error_shown', { code: 'save_failed' });
  });
});
