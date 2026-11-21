'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { useBackLayer } from '@/lib/open-layer';
import { Icon } from './icons';
import styles from './builder.module.css';

/** The ▾ menu's one item: "Only Chest Press (C1)". */
export const onlyThisLabel = (exerciseName: string, badge: string) => `Only ${exerciseName}${badge ? ` (${badge})` : ''}`;

/**
 * "+ Set ▾" on an exercise in a linked superset. The button adds a set to every exercise in the superset (a round,
 * see addRound): each copies its own last set. The ▾ opens a small menu with "Only <name> (<badge>)", which adds a set
 * to this exercise alone. `phone`: the phone editor's bottom bar (two lines, opens upward).
 */
export function SupersetAddSet({
  exerciseName,
  badge,
  onRound,
  onOnlyThis,
  phone = false,
}: {
  exerciseName: string;
  badge: string;
  onRound: () => void;
  onOnlyThis: () => void;
  phone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
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
      toggleRef.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  }

  const only = onlyThisLabel(exerciseName, badge);
  return (
    <div ref={wrapRef} className={cx(styles.splitAddSet, phone && styles.splitAddSetPhone)}>
      <button
        type="button"
        className={styles.splitMain}
        aria-label="Add a set to every exercise in the superset"
        title="Adds a copy of each exercise's last set"
        onClick={onRound}
        data-ph-capture-attribute-label="workout_add_round"
      >
        {phone ? (
          <>
            + Set <span className={styles.addSetHint}>copies last sets</span>
          </>
        ) : (
          <>
            + Set <span className={styles.addSetHint}>(copies last sets)</span>
          </>
        )}
      </button>
      <button
        type="button"
        ref={toggleRef}
        className={styles.splitToggle}
        aria-label="More ways to add a set"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-ph-capture-attribute-label="workout_add_set_menu"
      >
        <Icon name="chevron" size={18} />
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label="Add a set" className={cx(styles.menu, styles.splitMenu)} onKeyDown={onMenuKey}>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={itemRef}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onOnlyThis();
              }}
              data-ph-capture-attribute-label="workout_add_set_only"
            >
              {only}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
