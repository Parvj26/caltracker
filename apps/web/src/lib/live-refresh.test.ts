import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler, rejoinDelayMs } from './live-refresh';

describe('createRefreshScheduler', () => {
  let visible = true;
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  const make = () => createRefreshScheduler({ refresh, isVisible: () => visible, now: () => Date.now() });

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    refresh = vi.fn<() => void>();
  });
  afterEach(() => vi.useRealTimers());

  it('refreshes once, 500 ms after the last of a quick burst of changes', () => {
    const s = make();
    s.change();
    vi.advanceTimersByTime(300);
    s.change();
    vi.advanceTimersByTime(300);
    s.change();
    vi.advanceTimersByTime(499);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still refreshes within 2 s when changes keep coming', () => {
    const s = make();
    for (let i = 0; i < 10; i++) {
      s.change();
      vi.advanceTimersByTime(300);
    }
    // 3 s of changes every 300 ms: at least one refresh by the 2 s mark, never one per change.
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('does nothing while the tab is hidden, then refreshes once when it becomes visible', () => {
    const s = make();
    visible = false;
    s.change();
    s.change();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    s.visibility();
    expect(refresh).toHaveBeenCalledTimes(1);
    s.visibility();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a change waiting when the tab hides refreshes on return, not in the background', () => {
    const s = make();
    s.change();
    visible = false;
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    s.visibility();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('paused (a dialog is open)', () => {
    let paused = false;
    const makePausable = () =>
      createRefreshScheduler({ refresh, isVisible: () => visible, isPaused: () => paused, now: () => Date.now() });
    beforeEach(() => {
      paused = false;
    });

    it('holds changes while paused, then refreshes once when resumed', () => {
      const s = makePausable();
      paused = true;
      s.change();
      s.change();
      vi.advanceTimersByTime(5000);
      expect(refresh).not.toHaveBeenCalled();
      paused = false;
      s.resume();
      expect(refresh).toHaveBeenCalledTimes(1);
      s.resume();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('a change already waiting when a dialog opens waits for it to close', () => {
      const s = makePausable();
      s.change();
      paused = true;
      vi.advanceTimersByTime(1000);
      expect(refresh).not.toHaveBeenCalled();
      paused = false;
      s.resume();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('resuming with nothing missed does not refresh, and resuming while still paused does nothing', () => {
      const s = makePausable();
      paused = true;
      s.resume();
      paused = false;
      s.resume();
      expect(refresh).not.toHaveBeenCalled();
      paused = true;
      s.change();
      s.resume();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('a hidden tab still waits after the dialog closes', () => {
      const s = makePausable();
      paused = true;
      s.change();
      paused = false;
      visible = false;
      s.resume();
      expect(refresh).not.toHaveBeenCalled();
      visible = true;
      s.visibility();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it('becoming visible with nothing missed does not refresh', () => {
    const s = make();
    visible = false;
    s.visibility();
    visible = true;
    s.visibility();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('the first join does not refresh, a rejoin after a drop does', () => {
    const s = make();
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    for (const dropped of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
      s.status(dropped);
      s.status('SUBSCRIBED');
      vi.advanceTimersByTime(500);
    }
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('a first join that only succeeds after an error refreshes (changes may have been missed)', () => {
    const s = make();
    s.status('CHANNEL_ERROR');
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a rejoin while hidden waits for the tab to be visible', () => {
    const s = make();
    visible = false;
    s.status('TIMED_OUT');
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    s.visibility();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the first join refreshes when the server render is more than 1 s old', () => {
    const s = createRefreshScheduler({ refresh, isVisible: () => visible, now: () => Date.now(), renderedAt: Date.now() - 1500 });
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Only the first join: a second SUBSCRIBED without a drop does nothing.
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the first join right after the render does not refresh', () => {
    const s = createRefreshScheduler({ refresh, isVisible: () => visible, now: () => Date.now(), renderedAt: Date.now() - 300 });
    s.status('SUBSCRIBED');
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a longer maxWaitMs lets a steady stream wait longer (8 s on Home)', () => {
    const s = createRefreshScheduler({ refresh, isVisible: () => visible, now: () => Date.now(), maxWaitMs: 8000 });
    for (let i = 0; i < 20; i++) {
      s.change();
      vi.advanceTimersByTime(300);
    }
    // 6 s of changes every 300 ms: still waiting.
    expect(refresh).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) {
      s.change();
      vi.advanceTimersByTime(300);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('after dispose nothing refreshes, including a pending change', () => {
    const s = make();
    s.change();
    s.dispose();
    vi.advanceTimersByTime(1000);
    s.change();
    s.status('CLOSED');
    s.status('SUBSCRIBED');
    s.visibility();
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('rejoinDelayMs', () => {
  it('backs off from 1 s, doubling, up to 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(rejoinDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});
