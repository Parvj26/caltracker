'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui';
import styles from './builder.module.css';

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

/**
 * An exercise's "⋯" menu on a phone or iPad (Move to top, Move to…, Swap, Notes, Delete): it stands in for the row of
 * icon buttons, which don't fit there. Keyboard-driven like the other ⋯ menus: arrows move, Escape closes and returns
 * focus, Tab or a tap outside closes.
 */
export function BlockMenu({ name, items }: { name: string; items: readonly MenuItem[] }) {
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
        data-ph-capture-attribute-label="workout_block_menu"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label={`More for ${name}`} className={styles.menu} onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <li role="none" key={item.label}>
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                disabled={item.disabled}
                className={item.danger ? `${styles.menuItem} ${styles.menuItemDanger}` : styles.menuItem}
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

export type MoveTarget = { key: string; label: string; current?: boolean; onSelect: () => void };

/**
 * "Move to…": the exercise's section listed in order (tap a row to put the exercise in its place), then the other
 * sections it can move to. A window, so it works the same inside the program's day sheet.
 */
export function MoveToDialog({
  name,
  places,
  sections,
  onClose,
}: {
  name: string;
  places: readonly MoveTarget[];
  sections: readonly MoveTarget[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const pick = (t: MoveTarget) => {
    t.onSelect();
    onClose();
  };
  return (
    <dialog
      ref={ref}
      className={styles.moveDialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <h2 id={titleId} className={styles.blockTitle}>
        Move {name} to…
      </h2>
      <p className={styles.caption}>Tap the place it should go.</p>
      <ol className={styles.moveList}>
        {places.map((t, i) => (
          <li key={t.key}>
            <button type="button" className={styles.moveItem} disabled={t.current} onClick={() => pick(t)}>
              <span className={styles.blockNumber} aria-hidden="true">
                {i + 1}
              </span>
              <span>{t.label}</span>
              {t.current ? <span className={styles.caption}>(here now)</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {sections.length > 0 ? (
        <>
          <h3 className={styles.exerciseName}>Or move to a section</h3>
          <ul className={styles.moveList}>
            {sections.map((t) => (
              <li key={t.key}>
                <button type="button" className={styles.moveItem} onClick={() => pick(t)}>
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={styles.moveActions}>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
