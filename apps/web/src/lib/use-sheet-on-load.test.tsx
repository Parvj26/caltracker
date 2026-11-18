// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useSheetOnLoad } from './use-sheet-on-load';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  window.history.replaceState(null, '', '/');
});

/** Mounts components that each try to reopen `?sheet=` on load; resolves after the queued checks have run. */
async function mount(openers: ((id: string) => boolean)[]) {
  function Opener({ open }: { open: (id: string) => boolean }) {
    useSheetOnLoad(open);
    return null;
  }
  const el = document.createElement('div');
  root = createRoot(el);
  act(() => root!.render(openers.map((open, i) => createElement(Opener, { key: i, open }))));
  await act(() => new Promise((r) => setTimeout(r, 10)));
}

describe('useSheetOnLoad', () => {
  it('reopens the pop-up named in the address and leaves the address alone', async () => {
    window.history.replaceState(null, '', '/clients/c1/body?sheet=add-scan');
    const opened: string[] = [];
    await mount([
      (id) => {
        opened.push(id);
        return id === 'add-scan';
      },
    ]);
    expect(opened).toEqual(['add-scan']);
    expect(window.location.search).toBe('?sheet=add-scan');
  });

  it('takes off a ?sheet= nothing on the page claims, keeping the rest of the address', async () => {
    window.history.replaceState(null, '', '/clients/c1/body?range=1y&sheet=gone');
    await mount([() => false, () => false]);
    expect(window.location.search).toBe('?range=1y');
  });

  it('keeps it when another component on the page claims it, whichever runs first', async () => {
    window.history.replaceState(null, '', '/clients/c1/training?sheet=remove-c1');
    await mount([(id) => id === 'remove-c1', () => false]);
    expect(window.location.search).toBe('?sheet=remove-c1');
    window.history.replaceState(null, '', '/clients/c1/training?sheet=remove-c1');
    act(() => root?.unmount());
    await mount([() => false, (id) => id === 'remove-c1']);
    expect(window.location.search).toBe('?sheet=remove-c1');
  });

  it('does nothing without a ?sheet=', async () => {
    window.history.replaceState(null, '', '/home?q=ma');
    const opened: string[] = [];
    await mount([(id) => opened.push(id) > 0]);
    expect(opened).toEqual([]);
    expect(window.location.search).toBe('?q=ma');
  });
});
