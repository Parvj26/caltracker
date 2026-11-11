// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const startReplay = vi.fn();
const stopReplay = vi.fn();
vi.mock('./client', () => ({ startReplay, stopReplay }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.clearAllMocks());

describe('SessionReplayGate', () => {
  it('starts recording on mount and stops on unmount, rendering nothing', async () => {
    const { SessionReplayGate } = await import('./session-replay-gate');
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<SessionReplayGate />));
    expect(startReplay).toHaveBeenCalledTimes(1);
    expect(stopReplay).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe('');
    act(() => root.unmount());
    expect(stopReplay).toHaveBeenCalledTimes(1);
  });
});
