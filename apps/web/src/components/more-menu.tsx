'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { shouldOpenUp } from '@/components/calendar/menu-placement';
import { cx } from '@/components/ui/cx';
import styles from './more-menu.module.css';

export type MoreMenuItem = {
  label: string;
  onSelect: () => void;
  /** Destructive (Delete…): shown in red. */
  danger?: boolean;
  /** A small line icon before the label (decorative). */
  icon?: ReactNode;
};

/**
 * A "⋯" button with a short menu of actions. Keyboard-driven like the other ⋯ menus: arrows move, Escape closes and
 * returns focus, Tab or a tap outside closes. Opens upward when there's no room below. `label` names both the button
 * and the menu ("More for this post").
 */
export function MoreMenu({ label, items, disabled = false, className }: { label: string; items: MoreMenuItem[]; disabled?: boolean; className?: string | undefined }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (open && button && menu) menu.dataset.placement = shouldOpenUp(button, menu) ? 'up' : 'down';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = itemsRef.current.filter((x): x is HTMLButtonElement => x != null);
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      els[(at + step + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={cx(styles.wrap, className)}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.button}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open ? (
        <ul id={menuId} ref={menuRef} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <li role="none" key={item.label} className={item.danger && i > 0 ? styles.separated : undefined}>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                className={cx(styles.item, item.danger && styles.danger)}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  item.onSelect();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
