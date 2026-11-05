'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IsoDateSchema, scheduleDateError } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { calendarAddDomId, calendarItemDomId, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatShortDay } from '@/components/calendar/format';
import { Button, TextField } from '@/components/ui';
import type { CalendarEntry } from './client-calendar';
import styles from '@/components/calendar/calendar.module.css';

const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());

export function ItemMenu({
  item,
  editHref,
  onMove,
  onDelete,
}: {
  item: CalendarItem;
  editHref: string;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);

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
    const els = itemsRef.current.filter((x): x is HTMLElement => x !== null);
    const at = els.indexOf(document.activeElement as HTMLElement);
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
    <div ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className={styles.menuButton}
        aria-label={`Options for ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <ul id={menuId} role="menu" aria-label={`Options for ${item.name}`} className={styles.menu} onKeyDown={onMenuKey}>
          <li role="none">
            <Link href={editHref} role="menuitem" ref={(el) => {
                itemsRef.current[0] = el;
              }} className={styles.menuItem}>
              Edit
            </Link>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[1] = el;
              }}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onMove();
              }}
            >
              Move to…
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[2] = el;
              }}
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/* ---------- Move to… and Delete ---------- */

export function MoveDialog({
  entry,
  today,
  onMove,
  onClose,
}: {
  entry: CalendarEntry;
  /** The coach's own today, from the browser: single workouts move to today or later. */
  today: IsoDate;
  onMove: (date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [date, setDate] = useState(entry.date);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The item remounts on its new day: put focus back on it there.
    return () => {
      focusSoon(calendarItemDomId(entry.id));
    };
  }, [entry.id]);

  const parsed = IsoDateSchema.safeParse(date);
  const error = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Move {entry.name}</h2>
      <p className={styles.dialogBody}>Now on {formatShortDay(entry.date)}.</p>
      <TextField
        label="Date"
        type="date"
        min={today}
        value={date}
        onChange={(e) => setDate(e.target.value)}
        {...(error ? { error } : {})}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button disabled={error !== null} onClick={() => parsed.success && error === null && onMove(parsed.data)}>
          Move
        </Button>
      </div>
    </dialog>
  );
}

export function DeleteDialog({
  entry,
  clientName,
  onDelete,
  onClose,
}: {
  entry: CalendarEntry;
  clientName: string;
  onDelete: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The menu that opened this is gone: back to the item if it is still there, else to its day's "+".
    return () => {
      requestAnimationFrame(() =>
        (document.getElementById(calendarItemDomId(entry.id)) ?? document.getElementById(calendarAddDomId(entry.date)))?.focus(),
      );
    };
  }, [entry.id, entry.date]);
  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-describedby={bodyId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Delete {entry.name}?</h2>
      <p id={bodyId} className={styles.dialogBody}>
        Removes it from {clientName}&apos;s calendar on {formatShortDay(entry.date)}. Your library isn&apos;t changed.
      </p>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={onDelete}>Delete</Button>
      </div>
    </dialog>
  );
}
