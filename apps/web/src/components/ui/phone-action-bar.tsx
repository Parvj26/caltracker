'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './layout.module.css';

/** How much of the layout viewport the on-screen keyboard covers (iOS Safari doesn't shrink it), from visualViewport. */
export function keyboardCover(innerHeight: number, viewport: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(innerHeight - (viewport.height + viewport.offsetTop)));
}

/**
 * The bottom bar of an editing screen on a phone (docs/design/ui-rules.md §8): the main action(s) in thumb reach,
 * above the home indicator. While it is on screen the tab bar is hidden (data-no-menu-button), the page keeps room for
 * it under its last field, focused fields scroll clear of it, and with the keyboard open it rides on top of the
 * keyboard. From 600 px up it is a footer that sticks to the bottom of its form while the form is in view.
 */
export function PhoneActionBar({
  children,
  status,
  className,
  label = 'Actions',
}: {
  children: ReactNode;
  /** A short status before the buttons ("All changes saved", "Unsaved changes"), read out politely. */
  status?: ReactNode;
  className?: string | undefined;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const cover = viewport ? keyboardCover(window.innerHeight, viewport) : 0;
      el.style.setProperty('--action-bar-keyboard', `${cover}px`);
      // On the keyboard there's no home indicator to clear.
      el.toggleAttribute('data-keyboard', cover > 0);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    apply();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    const size = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height);
      setHeight(h);
      root.style.setProperty('--action-bar-room', `${h}px`);
    });
    size.observe(el);
    return () => {
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      size.disconnect();
      root.style.removeProperty('--action-bar-room');
    };
  }, []);

  return (
    <>
      {/* Room under the page's last field, so the fixed bar never covers it (phone only). */}
      <div className={styles.actionBarSpacer} style={{ height }} aria-hidden="true" />
      <div ref={ref} className={cx(styles.actionBar, className)} role="group" aria-label={label} data-no-menu-button="" data-phone-action-bar="">
        {status !== undefined && status !== null ? (
          <p className={styles.actionBarStatus} role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
        <div className={styles.actionBarButtons}>{children}</div>
      </div>
    </>
  );
}
