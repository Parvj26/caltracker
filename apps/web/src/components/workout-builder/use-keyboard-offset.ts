'use client';

import { useEffect, type RefObject } from 'react';

/** Phones and iPad portrait, where the save bar sits at the top (see builder.module.css). Not a desktop window. */
const TOUCH_TOP_BAR = '(max-width: 899.98px) and (pointer: coarse)';

/**
 * Keeps a top sticky bar in sight while the on-screen keyboard is open. iOS Safari pins sticky (and fixed) elements
 * to the layout viewport, and when the keyboard opens it pans the visible part of the page down inside it, so a bar
 * at `top: 0` ends up above the screen. This sets `--keyboard-offset` on the element to how far the visible part has
 * panned (visualViewport.offsetTop); the CSS adds it to the bar's `top`. Only on touch screens below 900 px, and not
 * inside a <dialog> (the program's day sheet), whose own position already follows the screen.
 */
export function useKeyboardOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const viewport = window.visualViewport;
    if (!el || !viewport || el.closest('dialog')) return;
    const media = window.matchMedia(TOUCH_TOP_BAR);
    let frame = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--keyboard-offset', `${Math.max(0, Math.round(viewport.offsetTop))}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    let listening = false;
    const sync = () => {
      if (media.matches && !listening) {
        viewport.addEventListener('resize', schedule);
        viewport.addEventListener('scroll', schedule);
        listening = true;
        apply();
      } else if (!media.matches && listening) {
        viewport.removeEventListener('resize', schedule);
        viewport.removeEventListener('scroll', schedule);
        listening = false;
        el.style.removeProperty('--keyboard-offset');
      }
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      el.style.removeProperty('--keyboard-offset');
    };
  }, [ref]);
}

/**
 * Keeps a bottom sheet (the phone set editor) above the on-screen keyboard. iOS Safari doesn't shrink the layout
 * viewport when the keyboard opens, so an element fixed to `bottom: 0` ends up behind it. This sets two properties on
 * the element from visualViewport: `--sheet-keyboard`, how much of the layout viewport the keyboard covers (the CSS
 * lifts the sheet by that much), and `--sheet-viewport`, the visible height (the CSS caps the sheet's height to it, so
 * it scrolls rather than running off the top).
 */
export function useSheetKeyboardInset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const viewport = window.visualViewport;
    if (!el || !viewport) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
      el.style.setProperty('--sheet-keyboard', `${Math.max(0, Math.round(covered))}px`);
      el.style.setProperty('--sheet-viewport', `${Math.round(viewport.height)}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      el.style.removeProperty('--sheet-keyboard');
      el.style.removeProperty('--sheet-viewport');
    };
  }, [ref]);
}
