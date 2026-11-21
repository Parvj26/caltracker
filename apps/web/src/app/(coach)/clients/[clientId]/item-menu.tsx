'use client';

import Link from 'next/link';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IsoDateSchema, quickDays, scheduleDateError } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { calendarAddDomId, calendarItemDomId, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatShortDay } from '@/components/calendar/format';
import { shouldOpenUp } from '@/components/calendar/menu-placement';
import { QuickDayPicker } from '@/components/assign/quick-day-picker';
import { errorMessage, type ErrorCode } from '@caltracker/shared';
import { AdaptiveDialog, Button, TextField, type AdaptiveDialogHandle } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { failureCode } from '@/lib/action-errors';
import { saveToLibrary } from './actions';
import type { CalendarEntry } from './client-calendar';
import styles from '@/components/calendar/calendar.module.css';
import { useBackLayer } from '@/lib/open-layer';

const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());

/**
 * One item's options. Today's or a missed workout gets `sessionHref` ("Log session"). A done workout gets `logHref`
 * ("View log") and `resultsHref` ("Edit results"), but no `editHref` and no move. A missed one gets `onMove` with the
 * label "Move to another day" (to today or later).
 */
export function ItemMenu({
  item,
  sessionHref,
  logHref,
  resultsHref,
  editHref,
  onMove,
  moveLabel = 'Move to…',
  onCopy,
  onSaveToLibrary,
  inLibrary = false,
  onDelete,
}: {
  item: CalendarItem;
  /** "Log session": the coach logs this workout with the client (today's, or a missed one). */
  sessionHref?: string | undefined;
  logHref?: string | undefined;
  /** The log with its correction form open. */
  resultsHref?: string | undefined;
  editHref?: string | undefined;
  onMove?: (() => void) | undefined;
  moveLabel?: string;
  /** "Copy to…": the workout as it is, onto another day and/or other clients. */
  onCopy?: (() => void) | undefined;
  /** "Save to Library": its plan as a new library workout. */
  onSaveToLibrary?: (() => void) | undefined;
  /** Still exactly a library workout: "✓ In Library", greyed out, instead of "Save to Library". */
  inLibrary?: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Back (and iOS swipe-back) closes the menu, not the page.
  useBackLayer(open, () => setOpen(false));
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLElement | null)[]>([]);
  const menuRef = useRef<HTMLUListElement>(null);

  // A card low on the screen opens its menu upward, so the menu isn't hidden below the screen's edge. Measured before
  // the menu is painted; set on the element (not rendered), so later renders keep it.
  useLayoutEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (open && button && menu) menu.dataset.placement = shouldOpenUp(button, menu) ? 'up' : 'down';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // No scroll: the menu may still be flipping above its button, and it is placed to be on screen.
    itemsRef.current.find((x) => x != null)?.focus({ preventScroll: true });
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  function onMenuKey(e: KeyboardEvent<HTMLUListElement>) {
    const els = itemsRef.current.filter((x): x is HTMLElement => x != null);
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
        <ul
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={`Options for ${item.name}`}
          className={styles.menu}
          onKeyDown={onMenuKey}
        >
          {sessionHref ? (
            <li role="none">
              <Link
                href={sessionHref}
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[0] = el;
                }}
                className={styles.menuItem}
              >
                Log session
              </Link>
            </li>
          ) : null}
          {logHref ? (
            <li role="none">
              <Link
                href={logHref}
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[1] = el;
                }}
                className={styles.menuItem}
              >
                View log
              </Link>
            </li>
          ) : null}
          {resultsHref ? (
            <li role="none">
              <Link
                href={resultsHref}
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[2] = el;
                }}
                className={styles.menuItem}
              >
                Edit results
              </Link>
            </li>
          ) : null}
          {editHref ? (
            <li role="none">
              <Link
                href={editHref}
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[3] = el;
                }}
                className={styles.menuItem}
              >
                Edit
              </Link>
            </li>
          ) : null}
          {onMove ? (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[4] = el;
                }}
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onMove();
                }}
              >
                {moveLabel}
              </button>
            </li>
          ) : null}
          {onCopy ? (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                ref={(el) => {
                  itemsRef.current[5] = el;
                }}
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onCopy();
                }}
              >
                Copy to…
              </button>
            </li>
          ) : null}
          {onSaveToLibrary ? (
            <li role="none">
              {inLibrary ? (
                // Shown but not usable (still reachable with the arrow keys, so it is read out).
                <button
                  type="button"
                  role="menuitem"
                  aria-disabled="true"
                  ref={(el) => {
                    itemsRef.current[6] = el;
                  }}
                  className={cx(styles.menuItem, styles.menuItemDone)}
                  onClick={(e) => e.preventDefault()}
                >
                  <span aria-hidden="true">✓{"\u00a0"}</span>In Library
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  ref={(el) => {
                    itemsRef.current[6] = el;
                  }}
                  className={styles.menuItem}
                  data-ph-capture-attribute-label="calendar_save_to_library"
                  onClick={() => {
                    setOpen(false);
                    onSaveToLibrary();
                  }}
                >
                  Save to Library
                </button>
              )}
            </li>
          ) : null}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemsRef.current[7] = el;
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
  clientName,
  today,
  dayWorkouts = [],
  onMove,
  onClose,
}: {
  entry: CalendarEntry;
  clientName?: string;
  /** The coach's own today, from the browser: single workouts move to today or later. */
  today: IsoDate;
  /** Workouts the calendar knows about, by day: quick days say "free" or how many, and a busy pick says so. */
  dayWorkouts?: readonly { date: IsoDate; name: string; id?: string }[];
  onMove: (date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const done = useRef(false);
  // The others on each day (not this workout itself).
  const others = dayWorkouts.filter((w) => w.id !== entry.id);
  const workoutsOn = (d: IsoDate) => others.filter((w) => w.date === d).length;
  // Quick days leave out the workout's own day; the first one is picked to start with.
  const [date, setDate] = useState<string>(() => quickDays(today, { exclude: [entry.date] })[0]?.date ?? today);

  // The item remounts on its new day: put focus back on it there.
  useEffect(
    () => () => {
      focusSoon(calendarItemDomId(entry.id));
    },
    [entry.id],
  );

  const parsed = IsoDateSchema.safeParse(date);
  const error = !parsed.success ? 'Pick a date.' : date === entry.date ? 'It is already on this day.' : scheduleDateError(parsed.data, today);
  const already = parsed.success && error === null ? others.filter((w) => w.date === parsed.data).map((w) => w.name) : [];

  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId={`move-${entry.id}`}
      title={`Move ${entry.name}`}
      subtitle={`${clientName ? `${clientName} · ` : ''}now on ${formatShortDay(entry.date)}`}
      onClose={onClose}
      noKeyboardOnTouch
      footer={
        <>
          <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()}>
            Cancel
          </Button>
          <Button
            disabled={error !== null}
            onClick={() => {
              if (!parsed.success || error !== null || done.current) return;
              done.current = true;
              const to = parsed.data;
              void dialogRef.current?.close().then(() => onMove(to));
            }}
          >
            {parsed.success && error === null ? `Move to ${formatShortDay(parsed.data)}` : 'Move'}
          </Button>
        </>
      }
    >
      <QuickDayPicker
        legend="Move to"
        today={today}
        value={date}
        onChange={setDate}
        exclude={[entry.date]}
        workoutsOn={workoutsOn}
        fieldMin={today}
        error={error}
      />
      {already.length > 0 ? (
        <p className={styles.dialogBody}>
          {formatShortDay(parsed.data!)} already has {already.join(', ')}. Moving there adds this alongside it.
        </p>
      ) : null}
    </AdaptiveDialog>
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
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const bodyId = useId();
  const done = useRef(false);
  // The menu that opened this is gone: back to the item if it is still there, else to its day's "+".
  useEffect(
    () => () => {
      requestAnimationFrame(() =>
        (document.getElementById(calendarItemDomId(entry.id)) ?? document.getElementById(calendarAddDomId(entry.date)))?.focus(),
      );
    },
    [entry.id, entry.date],
  );
  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId={`delete-workout-${entry.id}`}
      role="alertdialog"
      describedBy={bodyId}
      title={`Delete ${entry.name}?`}
      onClose={onClose}
      stackFooterOnPhone
      footer={
        <>
          <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (done.current) return;
              done.current = true;
              void dialogRef.current?.close().then(onDelete);
            }}
          >
            Delete workout
          </Button>
        </>
      }
    >
      <p id={bodyId} className={styles.dialogBody}>
        Removes it from {clientName}&apos;s calendar on {formatShortDay(entry.date)}. Your library isn&apos;t changed.
        {entry.logId ? ' The workout they logged stays in Activity.' : ''}
      </p>
    </AdaptiveDialog>
  );
}

/* ---------- Save to Library: a name clash ---------- */

/**
 * "Save to Library" when the Library already has a workout with this name: asks for another, starting from
 * "<name> (<first name>, <day>)". Saving with a name that is still taken says so here.
 */
export function LibraryNameDialog({
  entry,
  suggestion,
  onSaved,
  onClose,
}: {
  entry: CalendarEntry;
  suggestion: string;
  onSaved: (saved: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<AdaptiveDialogHandle>(null);
  const [name, setName] = useState(suggestion);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  // Back to the item's ⋯ button when done (the menu that opened this is gone).
  useEffect(
    () => () => {
      focusSoon(calendarItemDomId(entry.id));
    },
    [entry.id],
  );
  async function save() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const outcome = await saveToLibrary({ workoutId: entry.id, name });
      if (outcome.ok) {
        const saved = { id: outcome.id, name: outcome.name };
        void dialogRef.current?.close().then(() => onSaved(saved));
        return;
      }
      setError(outcome.code);
    } catch (e) {
      setError(failureCode(e, 'library_save_failed'));
    } finally {
      setPending(false);
    }
  }
  return (
    <AdaptiveDialog
      ref={dialogRef}
      historyId={`library-name-${entry.id}`}
      title="Save to Library"
      titleSafe
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => dialogRef.current?.requestClose()} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} pending={pending} disabled={name.trim() === ''} data-ph-capture-attribute-label="calendar_library_name_save">
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          hint={`“${entry.name}” is already in your Library.`}
          hintSafe={false}
          error={error ? { code: error, text: errorMessage(error) } : undefined}
        />
      </form>
    </AdaptiveDialog>
  );
}
