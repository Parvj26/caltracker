'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import menuStyles from '@/components/calendar/calendar.module.css';
import styles from './community.module.css';

/**
 * A post's "⋯" menu on touch screens, so Delete isn't a thumb's width from Pin. Keyboard-driven like the other ⋯
 * menus: arrows move, Escape closes and returns focus, Tab or a tap outside closes. `onDelete` asks before deleting.
 */
export function PostMenu({ className, disabled, onDelete }: { className?: string | undefined; disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // One item: the arrows keep focus on it.
      e.preventDefault();
      itemRef.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={cx(styles.menuWrap, className)}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.smallButton}
        aria-label="More for this post"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label="More for this post" className={menuStyles.menu} onKeyDown={onMenuKey}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={itemRef}
              className={menuStyles.menuItem}
              onClick={() => {
                setOpen(false);
                buttonRef.current?.focus();
                onDelete();
              }}
            >
              Delete post
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
