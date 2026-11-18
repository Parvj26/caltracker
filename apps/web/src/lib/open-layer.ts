'use client';

import { useEffect, useRef } from 'react';
import { showDialog } from '@/components/calendar/show-dialog';
import { DECIDE_MS, onBeforePush, pushLayer, type LayerHandle } from './history-layers';

type OpenLayerOptions = {
  /** On touch screens start on the dialog itself (see showDialog). */
  noKeyboardOnTouch?: boolean;
  /**
   * Back went past the dialog. The default does what Escape does: a `cancel` event (the dialog's own onCancel may ask
   * "Discard changes?" or close it through React state), then close() unless that was prevented.
   */
  onBack?: () => boolean | void | Promise<boolean | void>;
};

type Open = { layer: LayerHandle; opener: HTMLElement | null; done: () => void };
const open = new Map<HTMLDialogElement, Open>();
let observer: MutationObserver | null = null;

function focusBack(opener: HTMLElement | null) {
  const active = document.activeElement;
  const lost = !active || active === document.body || !active.isConnected;
  if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
}

/** Dialogs React has taken out of the page count as closed. */
function sweep() {
  for (const [dialog, o] of open) if (!dialog.isConnected) o.done();
}
// Before a new layer is pushed (a pop-up closing as the next one opens, in one render): so they stay in order.
onBeforePush(sweep);

function watch() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver(() => {
    sweep();
    if (open.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Opens a modal dialog as one step of history (ui-rules §8): Back closes it (and only it), as Escape would. Closing it
 * any way (close(), Escape, a form's method="dialog", or React taking it out of the page) steps back over its entry,
 * and focus goes back to whatever opened it. Use it instead of `dialog.showModal()`.
 */
export function openLayer(dialog: HTMLDialogElement, options: OpenLayerOptions = {}): void {
  if (dialog.open) return;
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  showDialog(dialog, options.noKeyboardOnTouch ? { noKeyboardOnTouch: true } : {});
  const layer = pushLayer(async () => {
    if (!dialog.isConnected || !dialog.open) return;
    if (options.onBack) return options.onBack();
    const cancel = new Event('cancel', { cancelable: true });
    if (dialog.dispatchEvent(cancel)) {
      dialog.close();
      return;
    }
    // Its own handler took over: it closed (React state) or it is asking first.
    await wait(DECIDE_MS);
    if (dialog.isConnected && dialog.open) return false;
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the dialog as `this`
  const nativeClose = HTMLDialogElement.prototype.close;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    open.delete(dialog);
    dialog.removeEventListener('close', onClose);
    if (Object.prototype.hasOwnProperty.call(dialog, 'close')) delete (dialog as { close?: unknown }).close;
    void layer.release();
    // The browser hands focus back when a dialog closes, but not when it is removed: do that here.
    setTimeout(() => focusBack(opener), 0);
  };
  const onClose = (e: Event) => {
    if (e.target === dialog) done();
  };
  // close() steps back at once (not a task later, with the close event), so a navigation straight after it waits.
  dialog.close = function close(this: HTMLDialogElement, returnValue?: string) {
    nativeClose.call(this, returnValue);
    done();
  };
  dialog.addEventListener('close', onClose);
  open.set(dialog, { layer, opener, done });
  watch();
}

/**
 * The same for a layer that is React state (a menu, a panel, a sheet that isn't a <dialog>): while `open`, Back calls
 * `onBack` (close it, or return false to stay open), and closing it any other way steps back over its entry.
 */
export function useBackLayer(isOpen: boolean, onBack: () => boolean | void) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  }, [onBack]);
  useEffect(() => {
    if (!isOpen) return;
    const layer = pushLayer(() => ref.current());
    return () => {
      void layer.release();
    };
  }, [isOpen]);
}

/** Open the dialog in `ref` as a layer once it mounts (the usual "mounted means open" pop-up). */
export function useOpenLayerOnMount(ref: { current: HTMLDialogElement | null }, options: OpenLayerOptions = {}) {
  const opts = useRef(options);
  useEffect(() => {
    const d = ref.current;
    if (d) openLayer(d, opts.current);
  }, [ref]);
}

/** openLayer on a ref's dialog, when it is mounted. */
export function openRef(ref: { current: HTMLDialogElement | null }, options: OpenLayerOptions = {}): void {
  if (ref.current) openLayer(ref.current, options);
}
