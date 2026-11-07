'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import menuStyles from '@/components/calendar/calendar.module.css';
import styles from './home.module.css';

/**
 * A row's "⋯" menu of links, keyboard-driven like the calendar's item menu (same look): arrows move, Escape closes and
 * returns focus, Tab or a click outside closes.
 */
export function RowMenu({ name, items }: { name: string; items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemsRef.current[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = itemsRef.current.filter((x): x is HTMLAnchorElement => x != null);
    const at = els.indexOf(document.activeElement as HTMLAnchorElement);
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
    <div ref={wrapRef} className={styles.menuWrap}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.moreButton}
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label={`More for ${name}`} className={menuStyles.menu} onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <li role="none" key={item.label}>
              <Link
                href={item.href}
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                className={menuStyles.menuItem}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
