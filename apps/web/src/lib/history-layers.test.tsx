// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushLayer, resetHistoryLayersForTests } from './history-layers';
import { openLayer } from './open-layer';
import { useHistoryLayer } from './use-history-layer';
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
  // A fresh page entry on top of whatever earlier tests left (forgotten first, so it isn't written under their layers).
  resetHistoryLayersForTests();
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

describe('review fixes', () => {
  it('a page’s own address change under an open layer is hidden from the router (no popstate reaches it)', async () => {
    const onBack = vi.fn();
    pushLayer(onBack);
    const router = vi.fn();
    window.addEventListener('popstate', router);
    act(() => {
      window.history.replaceState(window.history.state, '', '/workouts/w1?add=workout');
    });
    await settle();
    expect(router).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(window.history.state, '', '/workouts/w1');
    });
    await settle();
    expect(router).not.toHaveBeenCalled();
    window.removeEventListener('popstate', router);
    // The layer is still one Back away, and the page entry under it has the last address.
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search).toBe('/workouts/w1');
  });

  it('another history.back() waits its turn behind ours (no step is credited to the wrong one)', async () => {
    const layer = pushLayer(() => undefined);
    pushLayer(() => undefined);
    const go = vi.spyOn(window.history, 'go');
    // Ours: the top layer closes (one step); theirs: Next's router.back() at the same moment.
    void layer.release();
    window.history.back();
    await settle(200);
    go.mockRestore();
    // Nothing of ours is left on top, and we are below both layer entries.
    expect(seq()).toBeLessThanOrEqual(base);
  });

  it('a replaceState asked on a page that Back has since left is dropped, not written on the new page', async () => {
    window.history.pushState({}, '', '/prev');
    window.history.pushState({}, '', '/workouts/w1');
    const layer = pushLayer(() => undefined);
    // The step back over the layer races a second Back (a quick double swipe): it lands two pages back.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with history as `this`
    const real = History.prototype.go;
    const spy = vi.spyOn(window.history, 'go').mockImplementation((d?: number) => real.call(window.history, (d ?? 0) - 1));
    void layer.release();
    await act(() => Promise.resolve());
    // The old page's router writes its address meanwhile: it waits, then must not land on /prev.
    window.history.replaceState(null, '', '/workouts/w1?late=1');
    await settle(200);
    spy.mockRestore();
    expect(window.location.pathname).toBe('/prev');
    expect(window.location.search).toBe('');
  });

  it('router.push from code with a layer open writes the new page under nothing of ours: one Back returns', async () => {
    pushLayer(() => undefined);
    act(() => {
      window.history.pushState({}, '', '/workouts');
    });
    await settle(200);
    expect(window.location.pathname).toBe('/workouts');
    await userBack();
    expect(window.location.pathname).toBe('/workouts/w1');
    expect(seq()).toBe(base);
  });

  it('openLayer and useHistoryLayer share one stack: Back closes the address pop-up first, then the dialog under it', async () => {
    const d = document.createElement('dialog');
    document.body.append(d);
    openLayer(d);
    const onBack = vi.fn();
    function Pop() {
      useHistoryLayer({ id: 'assign-x', onBack });
      return null;
    }
    act(() => root.render(createElement(Pop)));
    await settle();
    expect(new URL(window.location.href).searchParams.get('sheet')).toBe('assign-x');
    await userBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(d.open).toBe(true);
    expect(new URL(window.location.href).searchParams.get('sheet')).toBeNull();
    act(() => root.render(null));
    await userBack();
    expect(d.open).toBe(false);
    expect(seq()).toBe(base);
    d.remove();
  });
});
