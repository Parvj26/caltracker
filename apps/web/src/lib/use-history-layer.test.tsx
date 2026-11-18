// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveDialog } from '@/components/ui/adaptive-dialog';
import { SearchBox } from '@/components/ui/search-box';
import { openLayerCount } from './history-layers';
import { useHistoryLayer } from './use-history-layer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom runs history.back() later and then fires popstate: wait for it. */
const back = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => setTimeout(resolve, 0), { once: true });
        window.history.back();
      }),
  );
/** One macrotask, inside act, so React and the history module run what they queued. */
const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
/**
 * Waits until `check` passes (history steps and their popstate land later in jsdom, later still on a slow CI runner),
 * instead of a fixed sleep. Fails after 3 s.
 */
const until = (check: () => void) =>
  vi.waitFor(
    async () => {
      await tick();
      check();
    },
    { timeout: 3000, interval: 5 },
  );
const sheetParam = () => new URL(window.location.href).searchParams.get('sheet');

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  // jsdom has <dialog> but no modal behaviour.
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(async () => {
  window.history.replaceState(null, '', '/workouts');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await tick();
});

afterEach(async () => {
  act(() => {
      root.unmount();
    });
  host.remove();
  // Every layer the test left open has stepped off the history.
  await until(() => expect(openLayerCount()).toBe(0));
});

function Layer({ onBack }: { onBack: () => boolean | void }) {
  useHistoryLayer({ id: 'assign-w1', onBack });
  return null;
}

describe('useHistoryLayer', () => {
  it('adds ?sheet=<id> while open, and Back calls onBack and leaves the page as it was', async () => {
    const onBack = vi.fn();
    act(() => {
      root.render(createElement(Layer, { onBack }));
    });
    expect(sheetParam()).toBe('assign-w1');
    await back();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(sheetParam()).toBeNull();
    expect(window.location.pathname).toBe('/workouts');
  });

  it('keeps the layer in history when onBack returns false (unsaved changes)', async () => {
    const onBack = vi.fn(() => false);
    act(() => {
      root.render(createElement(Layer, { onBack }));
    });
    await back();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(sheetParam()).toBe('assign-w1');
  });

  it('release() steps back over the entry without calling onBack', async () => {
    const onBack = vi.fn();
    const handle: { release: () => Promise<void> } = { release: () => Promise.resolve() };
    function WithRelease() {
      const { release } = useHistoryLayer({ id: 'rename-w1', onBack });
      useEffect(() => {
        handle.release = release;
      }, [release]);
      return null;
    }
    act(() => {
      root.render(createElement(WithRelease));
    });
    expect(sheetParam()).toBe('rename-w1');
    await act(() => handle.release());
    expect(onBack).not.toHaveBeenCalled();
    expect(sheetParam()).toBeNull();
  });

  it('a leftover ?sheet= in the address (shared link, reload) is not mistaken for its own step: closing stays on the page', async () => {
    window.history.replaceState(null, '', '/stale-page?sheet=assign-w9');
    const handle: { release: () => Promise<void> } = { release: () => Promise.resolve() };
    function Stale() {
      const { release } = useHistoryLayer({ id: 'assign-w9', onBack: () => undefined });
      useEffect(() => {
        handle.release = release;
      }, [release]);
      return null;
    }
    act(() => {
      root.render(createElement(Stale));
    });
    expect(sheetParam()).toBe('assign-w9');
    await act(() => handle.release());
    expect(window.location.pathname).toBe('/stale-page');
    expect(sheetParam()).toBeNull();
  });

  it('a slow Back during release() is never followed by a second Back when the layer unmounts', async () => {
    const handle: { release: () => Promise<void> } = { release: () => Promise.resolve() };
    function Slow() {
      const { release } = useHistoryLayer({ id: 'delete-w1', onBack: () => undefined });
      useEffect(() => {
        handle.release = release;
      }, [release]);
      return null;
    }
    act(() => {
      root.render(createElement(Slow));
    });
    // Steps back go through history.go().
    const spy = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    try {
      // Back never answers: release() gives up waiting after its timeout.
      await act(() => handle.release());
      act(() => {
        root.render(null);
      });
      await until(() => expect(spy).toHaveBeenCalledTimes(1));
    } finally {
      spy.mockRestore();
    }
  });
});

function Harness({ dirty, onClose, busy = false, role = 'dialog' }: { dirty: boolean; onClose: () => void; busy?: boolean; role?: 'dialog' | 'alertdialog' }) {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(
        AdaptiveDialog,
        {
          historyId: 'assign-w2',
          title: 'Assign',
          dirty,
          busy,
          role,
          onClose: () => {
            setOpen(false);
            onClose();
          },
          footer: [createElement('button', { type: 'button', key: 'c' }, 'Cancel'), createElement('button', { type: 'button', key: 'a' }, 'Assign')],
        },
        createElement('input', { 'aria-label': 'Name' }),
      )
    : null;
}

describe('AdaptiveDialog and Back', () => {
  it('closes on Back when nothing changed', async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(Harness, { dirty: false, onClose }));
    });
    expect(host.querySelector('dialog[open]')).not.toBeNull();
    await back();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.querySelector('dialog')).toBeNull();
    expect(sheetParam()).toBeNull();
  });

  it('asks "Discard changes?" on Back with unsaved changes, and Discard closes it', async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(Harness, { dirty: true, onClose }));
    });
    await back();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Discard changes?');
    expect(sheetParam()).toBe('assign-w2');
    const discard = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!;
    act(() => {
      discard.click();
    });
    await until(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(sheetParam()).toBeNull();
    });
  });

  it('Keep editing leaves it open', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(Harness, { dirty: true, onClose }));
    });
    const x = host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    act(() => {
      x.click();
    });
    expect(host.textContent).toContain('Discard changes?');
    const keep = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Keep editing')!;
    act(() => {
      keep.click();
    });
    expect(host.textContent).not.toContain('Discard changes?');
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('dialog[open]')).not.toBeNull();
  });

  it('starts on the first field, not on ×', () => {
    act(() => {
      root.render(createElement(Harness, { dirty: false, onClose: vi.fn() }));
    });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Name');
  });

  it('a confirm starts on its safe button (Cancel)', () => {
    act(() => {
      root.render(createElement(Harness, { dirty: false, onClose: vi.fn(), role: 'alertdialog' }));
    });
    expect(document.activeElement?.textContent).toBe('Cancel');
  });

  it('hides the Discard question while saving', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(createElement(Harness, { dirty: true, onClose }));
    });
    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    expect(host.textContent).toContain('Discard changes?');
    act(() => {
      root.render(createElement(Harness, { dirty: true, onClose, busy: true }));
    });
    expect(host.textContent).not.toContain('Discard changes?');
  });

  it('Escape in a SearchBox with text clears it first; the next Escape closes (asking first when there are changes)', () => {
    function WithSearch() {
      const [q, setQ] = useState('maya');
      return createElement(
        AdaptiveDialog,
        { historyId: 'assign-w3', title: 'Assign', dirty: true, onClose: vi.fn() },
        createElement(SearchBox, { label: 'Search clients', value: q, onChange: setQ }),
      );
    }
    act(() => {
      root.render(createElement(WithSearch));
    });
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const esc = () =>
      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
    esc();
    expect(input.value).toBe('');
    expect(host.textContent).not.toContain('Discard changes?');
    esc();
    expect(host.textContent).toContain('Discard changes?');
    expect(host.querySelector('dialog[open]')).not.toBeNull();
  });
});
