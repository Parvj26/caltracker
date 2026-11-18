// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveDialog } from '@/components/ui/adaptive-dialog';
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
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
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
  await settle();
});

afterEach(async () => {
  act(() => {
      root.unmount();
    });
  host.remove();
  await settle();
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
});

function Harness({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(AdaptiveDialog, {
        historyId: 'assign-w2',
        title: 'Assign',
        dirty,
        onClose: () => {
          setOpen(false);
          onClose();
        },
        footer: createElement('button', { type: 'button' }, 'Assign'),
      })
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
    await settle();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheetParam()).toBeNull();
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
});
