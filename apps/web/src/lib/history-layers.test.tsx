// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, resetHistoryLayersForTests } from './history-layers';
import { openLayer } from './open-layer';
import { useUnsavedGuard } from './use-unsaved-guard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = (ms = 60) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/** The user's Back (not one of ours). */
const userBack = async () => {
  // Straight to the browser: the wrapped history.back() counts as other code's step. (Our popstate listener may hide
  // the event from later listeners, so just wait.)
  History.prototype.back.call(window.history);
  await settle();
};
const seq = () => (window.history.state as { ctSeq?: number } | null)?.ctSeq ?? 0;

let root: Root;
let host: HTMLDivElement;
let base = 0;

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(async () => {
  // A fresh page entry on top of whatever earlier tests left.
  window.history.pushState({ page: Math.random() }, '', '/workouts/w1');
  resetHistoryLayersForTests();
  base = seq();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await settle(10);
});

afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  await settle();
});

describe('pushLayer', () => {
  it('adds one entry; Back calls onBack and leaves the page entry current', async () => {
    const onBack = vi.fn();
    pushLayer(onBack);
    expect(seq()).toBeGreaterThan(base);
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(seq()).toBe(base);
    expect(window.location.pathname).toBe('/workouts/w1');
  });

  it('stays (and is pushed again) when onBack returns false', async () => {
    const onBack = vi.fn(() => false);
    pushLayer(onBack);
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(seq()).toBeGreaterThan(base);
    // Still one step: Back again asks again.
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('release() steps back over its entry without calling onBack', async () => {
    const onBack = vi.fn();
    const layer = pushLayer(onBack);
    await act(() => layer.release());
    expect(onBack).not.toHaveBeenCalled();
    expect(seq()).toBe(base);
  });

  it('nested layers close one per Back', async () => {
    const a = vi.fn();
    const b = vi.fn();
    pushLayer(a);
    pushLayer(b);
    await userBack();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    await userBack();
    expect(a).toHaveBeenCalledTimes(1);
    expect(seq()).toBe(base);
  });

  it('a navigation right after closing a layer waits for the step back, so it is not undone', async () => {
    const layer = pushLayer(() => undefined);
    void layer.release();
    await act(async () => {
      await Promise.resolve();
      window.history.pushState({ next: true }, '', '/programs');
    });
    await settle();
    expect(window.location.pathname).toBe('/programs');
    await userBack();
    // One Back from the new page lands on the page under the closed layer, not on the layer's dead entry.
    expect(window.location.pathname).toBe('/workouts/w1');
    expect(seq()).toBe(base);
  });

  it('a replaceState(null, …) on top of a layer keeps the layer and moves the address under it', async () => {
    const onBack = vi.fn();
    pushLayer(onBack);
    act(() => {
      window.history.replaceState(null, '', '/workouts/w1?q=squat');
    });
    await settle();
    expect(window.location.search).toBe('?q=squat');
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    // The page entry got the new address too.
    expect(window.location.search).toBe('?q=squat');
  });
});

describe('openLayer', () => {
  it('Back closes a plain dialog', async () => {
    const d = document.createElement('dialog');
    document.body.append(d);
    openLayer(d);
    expect(d.open).toBe(true);
    await userBack();
    expect(d.open).toBe(false);
    expect(seq()).toBe(base);
    d.remove();
  });

  it('Back runs the dialog’s own Escape handling: React state closing it', async () => {
    function Sheet({ onClose }: { onClose: () => void }) {
      return createElement('dialog', {
        ref: (el: HTMLDialogElement | null) => {
          if (el) openLayer(el);
        },
        onCancel: (e: Event) => {
          e.preventDefault();
          onClose();
        },
      });
    }
    function Page() {
      const [open, setOpen] = useState(true);
      return createElement(
        'div',
        null,
        createElement('button', { id: 'opener' }, 'Open'),
        open ? createElement(Sheet, { onClose: () => setOpen(false) }) : null,
      );
    }
    act(() => root.render(createElement(Page)));
    expect(host.querySelector('dialog')).not.toBeNull();
    await userBack();
    expect(host.querySelector('dialog')).toBeNull();
    expect(seq()).toBe(base);
  });

  it('Back keeps a dialog open when its Escape handling asks first', async () => {
    const d = document.createElement('dialog');
    d.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(d);
    openLayer(d);
    await userBack();
    expect(d.open).toBe(true);
    expect(seq()).toBeGreaterThan(base);
    d.close();
    await settle();
    expect(seq()).toBe(base);
    d.remove();
  });

  it('removing an open dialog steps back and gives focus back to the opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const d = document.createElement('dialog');
    d.append(document.createElement('input'));
    document.body.append(d);
    openLayer(d);
    d.querySelector('input')!.focus();
    d.remove();
    await settle();
    expect(seq()).toBe(base);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('useUnsavedGuard', () => {
  function Editor({ dirty }: { dirty: boolean }) {
    const guard = useUnsavedGuard(dirty);
    return createElement('div', null, createElement('a', { href: '/programs', id: 'away' }, 'Programs'), guard.prompt);
  }
  const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text);

  it('pushes nothing while clean', async () => {
    act(() => root.render(createElement(Editor, { dirty: false })));
    await settle();
    expect(seq()).toBe(base);
  });

  it('Back while dirty asks; Keep editing stays on the page', async () => {
    act(() => root.render(createElement(Editor, { dirty: true })));
    await settle();
    const guardSeq = seq();
    expect(guardSeq).toBeGreaterThan(base);
    await userBack();
    expect(document.body.textContent).toContain('Discard changes?');
    act(() => button('Keep editing')!.click());
    await settle(800);
    expect(document.body.textContent).not.toContain('Discard changes?');
    expect(window.location.pathname).toBe('/workouts/w1');
    // The guard is on again: one more Back asks again.
    expect(seq()).toBeGreaterThan(base);
  });

  it('Back while dirty, then Discard, leaves the page', async () => {
    window.history.pushState({ x: 1 }, '', '/workouts/w2');
    resetHistoryLayersForTests();
    const page = seq();
    act(() => root.render(createElement(Editor, { dirty: true })));
    await settle();
    await userBack();
    act(() => button('Discard')!.click());
    await settle(900);
    expect(window.location.pathname).toBe('/workouts/w1');
    expect(seq()).toBeLessThan(page);
  });

  it('a link while dirty asks first; Keep editing does not follow it', async () => {
    act(() => root.render(createElement(Editor, { dirty: true })));
    await settle();
    const followed = vi.fn();
    const onLink = (e: Event) => {
      if ((e.target as Element).id !== 'away') return;
      e.preventDefault();
      followed();
    };
    host.addEventListener('click', onLink);
    act(() => host.querySelector<HTMLAnchorElement>('#away')!.click());
    await settle();
    expect(followed).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Discard changes?');
    act(() => button('Keep editing')!.click());
    await settle(800);
    expect(followed).not.toHaveBeenCalled();
    host.removeEventListener('click', onLink);
  });

  it('a link while dirty, then Discard, follows it (after taking the guard entry off)', async () => {
    act(() => root.render(createElement(Editor, { dirty: true })));
    await settle();
    const followed = vi.fn();
    const onLink = (e: Event) => {
      if ((e.target as Element).id !== 'away') return;
      e.preventDefault();
      followed();
    };
    host.addEventListener('click', onLink);
    act(() => host.querySelector<HTMLAnchorElement>('#away')!.click());
    await settle();
    act(() => button('Discard')!.click());
    await settle(900);
    expect(followed).toHaveBeenCalledTimes(1);
    expect(seq()).toBe(base);
    host.removeEventListener('click', onLink);
  });

  it('saving (clean again) takes the guard entry off', async () => {
    act(() => root.render(createElement(Editor, { dirty: true })));
    await settle();
    expect(seq()).toBeGreaterThan(base);
    act(() => root.render(createElement(Editor, { dirty: false })));
    await settle();
    expect(seq()).toBe(base);
  });
});
