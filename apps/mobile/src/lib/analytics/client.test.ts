import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('posthog-react-native');
});

function mockPostHog(capture: (...a: unknown[]) => void) {
  const ctor = vi.fn();
  vi.doMock('posthog-react-native', () => ({
    default: class {
      constructor(...a: unknown[]) {
        ctor(...a);
      }
      capture = capture;
      reset = vi.fn();
    },
  }));
  return ctor;
}

describe('track (phone)', () => {
  it('does nothing without a key', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', '');
    const capture = vi.fn();
    const ctor = mockPostHog(capture);
    const { track } = await import('./client');
    track('app_opened');
    expect(ctor).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('never throws when PostHog throws', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    mockPostHog(() => {
      throw new Error('boom');
    });
    const { track } = await import('./client');
    expect(() => track('app_opened')).not.toThrow();
  });

  it('sends sanitized properties and turns off session replay and touch text', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    const capture = vi.fn();
    const ctor = mockPostHog(capture);
    const { track } = await import('./client');
    track('task_completed', { task: 'log_meal', calories: 500 });
    expect(capture).toHaveBeenCalledWith('task_completed', { task: 'log_meal' });
    expect(ctor.mock.calls[0]?.[1]).toMatchObject({ enableSessionReplay: false });
  });

  it('reset drops open tasks', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    const capture = vi.fn();
    mockPostHog(capture);
    const { getTaskTracker, resetAnalytics } = await import('./client');
    getTaskTracker().start('log_workout');
    resetAnalytics();
    getTaskTracker().complete('log_workout');
    expect(capture.mock.calls.map((c: unknown[]) => c[0])).toEqual(['task_started']);
  });
});

describe('identifyPerson (phone)', () => {
  it('identifies again once the coach workspace is known', async () => {
    vi.stubEnv('EXPO_PUBLIC_POSTHOG_KEY', 'phc_test');
    const identify = vi.fn();
    vi.doMock('posthog-react-native', () => ({ default: class { capture = vi.fn(); identify = identify; reset = vi.fn(); } }));
    const { identifyPerson } = await import('./client');
    const base = { id: 'u1', name: 'A', email: 'a@x.com', workspaceName: null };
    identifyPerson({ ...base, workspaceId: null });
    identifyPerson({ ...base, workspaceId: null });
    identifyPerson({ ...base, workspaceId: 'w1', workspaceName: 'Coach' });
    expect(identify).toHaveBeenCalledTimes(2);
    expect(identify.mock.calls[1]?.[1]).toMatchObject({ workspace_id: 'w1', workspace_name: 'Coach' });
  });
});
