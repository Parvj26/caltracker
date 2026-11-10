'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { SET_KINDS, SET_KIND_NAMES } from '@caltracker/shared';
import type { SetKind } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import styles from './builder.module.css';

const LETTER_CLASS: Record<SetKind, string | undefined> = {
  W: styles.kindW,
  N: styles.kindN,
  F: styles.kindF,
  D: styles.kindD,
};

/**
 * A set's type as one letter (W warm-up, N normal, F failure, D drop set). Tapping it opens a menu of the four,
 * each with its letter and full name, the current one ticked. Keyboard: arrows move, Escape closes and returns focus,
 * Tab or a click outside closes. D is unavailable on a first set (a drop follows the set above).
 */
export function SetTypeMenu({
  kind,
  setName,
  canDrop,
  onPick,
}: {
  kind: SetKind;
  /** For the menu's name, e.g. "Barbell Squat set 2". */
  setName: string;
  canDrop: boolean;
  onPick: (kind: SetKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const current = SET_KINDS.indexOf(kind);
    (itemsRef.current[current] ?? itemsRef.current[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
    // Focus the ticked item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const els = itemsRef.current.filter((x): x is HTMLButtonElement => x != null && !x.disabled);
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      els[(at + step + els.length) % els.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={styles.typeWrap}>
      <button
        type="button"
        ref={buttonRef}
        className={cx(styles.kindButton, LETTER_CLASS[kind], open && styles.kindButtonOpen)}
        aria-label={`Set type: ${SET_KIND_NAMES[kind]}`}
        title={`Set type: ${SET_KIND_NAMES[kind]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {kind}
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={`Set type for ${setName}`} className={styles.kindMenu} onKeyDown={onMenuKey}>
          {SET_KINDS.map((k, i) => {
            const disabled = k === 'D' && !canDrop;
            return (
              <button
                key={k}
                type="button"
                role="menuitemradio"
                aria-checked={k === kind}
                disabled={disabled}
                title={disabled ? 'A drop set follows the set above, so the first set can’t be one.' : undefined}
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                className={cx(styles.kindItem, k === kind && styles.kindItemOn)}
                onClick={() => {
                  if (k !== kind) onPick(k);
                  close();
                }}
              >
                <span className={cx(styles.kindChip, LETTER_CLASS[k])} aria-hidden="true">
                  {k}
                </span>
                <span>{SET_KIND_NAMES[k]}</span>
                {k === kind ? (
                  <span className={styles.kindTick} aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
