'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import menuStyles from '@/components/calendar/calendar.module.css';
import { cx } from '@/components/ui/cx';
import styles from './more-menu.module.css';

export type MoreMenuItem = {
  label: string;
  onSelect: () => void;
  /** Destructive (Delete, Cancel invite): shown in red. It should ask before doing anything. */
  danger?: boolean;
  disabled?: boolean;
};

/**
 * A list row's "⋯" button and its menu of actions (Duplicate, Delete…; Resend, Cancel invite…). Keyboard-driven like
 * the calendar's item menu (same look): arrows move, Escape closes and returns focus, Tab or a click outside closes.
 */
export function MoreMenu({ label, items, busy = false, className }: { label: string; items: MoreMenuItem[]; busy?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current.find((el) => el && !el.disabled)?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = itemsRef.current.filter((x): x is HTMLButtonElement => x != null && !x.disabled);
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
        className={styles.more}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label={label} className={cx(menuStyles.menu, styles.menu)} onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <li role="none" key={item.label}>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                className={cx(menuStyles.menuItem, item.danger && styles.danger)}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
