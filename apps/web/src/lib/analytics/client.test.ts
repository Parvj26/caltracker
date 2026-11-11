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

describe('session recording (web)', () => {
  function mockPosthog() {
    const ph = { init: vi.fn(), capture: vi.fn(), reset: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn() };
    vi.doMock('posthog-js', () => ({ default: ph }));
    return ph;
  }

  it('never starts while NEXT_PUBLIC_SESSION_REPLAY is not "on"', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', '');
    const ph = mockPosthog();
    const { initAnalytics, startReplay } = await import('./client');
    startReplay();
    initAnalytics();
    startReplay();
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
  });

  it('starts once, with no arguments, when asked before PostHog is initialised', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', 'on');
    const ph = mockPosthog();
    const { initAnalytics, startReplay } = await import('./client');
    startReplay();
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    initAnalytics();
    startReplay();
    expect(ph.startSessionRecording).toHaveBeenCalledTimes(1);
    expect(ph.startSessionRecording).toHaveBeenCalledWith();
  });

  it('does nothing without a key, even with the switch on', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', 'on');
    const ph = mockPosthog();
    const { initAnalytics, startReplay, stopReplay } = await import('./client');
    startReplay();
    initAnalytics();
    stopReplay();
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    expect(ph.stopSessionRecording).not.toHaveBeenCalled();
  });

  it('stopReplay stops the recording, and a later init does not restart it', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', 'on');
    const ph = mockPosthog();
    const { initAnalytics, startReplay, stopReplay } = await import('./client');
    startReplay();
    stopReplay();
    initAnalytics();
    expect(ph.startSessionRecording).not.toHaveBeenCalled();
    startReplay();
    stopReplay();
    expect(ph.stopSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('signing out stops the recording', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', 'on');
    const ph = mockPosthog();
    const { initAnalytics, resetAnalytics, startReplay } = await import('./client');
    initAnalytics();
    startReplay();
    resetAnalytics();
    expect(ph.stopSessionRecording).toHaveBeenCalled();
    expect(ph.reset).toHaveBeenCalled();
  });

  it('never throws when PostHog throws', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_SESSION_REPLAY', 'on');
    const boom = () => {
      throw new Error('boom');
    };
    vi.doMock('posthog-js', () => ({ default: { init: vi.fn(), reset: vi.fn(), startSessionRecording: boom, stopSessionRecording: boom } }));
    const { initAnalytics, resetAnalytics, startReplay, stopReplay } = await import('./client');
    initAnalytics();
    expect(() => {
      startReplay();
      stopReplay();
      resetAnalytics();
    }).not.toThrow();
  });

  it('keeps recording off at init and passes the privacy config and our own host for tracing headers', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubGlobal('window', { location: { hostname: 'caltracker.app', host: 'caltracker.app' } });
    const ph = mockPosthog();
    const { initAnalytics } = await import('./client');
    const { RECORDING_CONFIG } = await import('./replay-config');
    initAnalytics();
    vi.unstubAllGlobals();
    const config = ph.init.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(config.disable_session_recording).toBe(true);
    expect(config.session_recording).toBe(RECORDING_CONFIG.session_recording);
    expect(config.capture_performance).toEqual({ network_timing: false });
    expect(config.enable_recording_console_log).toBe(false);
    expect(config.addTracingHeaders).toEqual(['caltracker.app']);
  });
});
