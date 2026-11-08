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

describe('quick undo (web)', () => {
  it('reports a delete within 30 seconds of creating', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    const capture = vi.fn();
    vi.doMock('posthog-js', () => ({ default: { capture, init: vi.fn() } }));
    const { initAnalytics, markCreated, markUndone } = await import('./client');
    initAnalytics();
    vi.useFakeTimers();
    markCreated('program', 'p1');
    vi.advanceTimersByTime(29_000);
    markUndone('program', 'p1');
    markCreated('program', 'p2');
    vi.advanceTimersByTime(31_000);
    markUndone('program', 'p2');
    markUndone('program', 'never-made');
    vi.useRealTimers();
    expect(capture.mock.calls).toEqual([['quick_undo', { item_type: 'program' }]]);
  });
});

describe('build_program (web)', () => {
  it('completes only for the program that was just created', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    const capture = vi.fn();
    vi.doMock('posthog-js', () => ({ default: { capture, init: vi.fn() } }));
    const { initAnalytics, programWorkoutSaved, setBuildingProgram, startBuildingProgram } = await import('./client');
    initAnalytics();
    startBuildingProgram();
    setBuildingProgram('p1');
    programWorkoutSaved('p2');
    expect(capture.mock.calls.map((c: unknown[]) => c[0])).toEqual(['task_started']);
    programWorkoutSaved('p1');
    expect(capture.mock.calls.map((c: unknown[]) => c[0])).toEqual(['task_started', 'task_completed']);
  });
});
