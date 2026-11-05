'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { IsoDateSchema, localToday } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { calendarAddDomId, calendarItemDomId, MonthCalendar, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatDayMonth, formatShortDay } from '@/components/calendar/format';
import { Button, Card, TextField } from '@/components/ui';
import { WorkoutPicker } from '../../programs/[id]/workout-picker';
import { deleteClientWorkout, moveClientWorkout, scheduleWorkout, unassignProgram } from './actions';
import { AssignDialog } from './assign-dialog';
import styles from '@/components/calendar/calendar.module.css';

export type CalendarEntry = CalendarItem & { date: IsoDate };
export type AssignmentSummary = {
  id: string;
  programName: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Its workouts' dates from about today on (the browser decides exactly which are upcoming). */
  dates: IsoDate[];
};
export type PickerProgram = { id: string; name: string; weeks: number; slots: { week: number; day: number }[] };
type LibraryWorkout = { id: string; name: string };

const SAVE_ERROR = "Couldn't save that change, so it was undone. Please try again.";
const subscribe = () => () => {};
const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());
const workoutsText = (n: number) => `${n} ${n === 1 ? 'workout' : 'workouts'}`;

/**
 * Today in the coach's browser. The server (UTC on Workers) renders UTC's date first and the browser corrects it
 * right after hydration, so a coach in Auckland or Los Angeles sees their own date (Review Focus 3).
 */
export function useLocalToday(): IsoDate {
  return useSyncExternalStore(subscribe, () => localToday(), () => localToday('UTC'));
}

/**
 * One client's month: assign a program, add single library workouts with each day's "+", and move (drag or
 * "Move to…"), edit or delete single workouts. Moves and deletes show at once and are undone, with a message, if
 * saving fails; the server re-sends the calendar after every change.
 */
export function ClientCalendar({
  client,
  month: monthParam,
  entries,
  assignments,
  library,
  programs,
}: {
  client: { id: string; name: string };
  month: string | null;
  entries: CalendarEntry[];
  assignments: AssignmentSummary[];
  library: LibraryWorkout[];
  programs: PickerProgram[];
}) {
  const today = useLocalToday();
  const month = monthParam ?? today.slice(0, 7);
  const [items, setItems] = useState(entries);
  const [shown, setShown] = useState(entries);
  if (shown !== entries) {
    // Fresh data from the server (after a save or navigation) replaces the local copy.
    setShown(entries);
    setItems(entries);
  }
  const [assigning, setAssigning] = useState(false);
  const [picker, setPicker] = useState<{ date: IsoDate; newId: string } | null>(null);
  const [moving, setMoving] = useState<CalendarEntry | null>(null);
  const [deleting, setDeleting] = useState<CalendarEntry | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Leaving while a move or delete is still saving would drop it: ask first.
  useEffect(() => {
    if (inFlight === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [inFlight]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  function optimistic(
    apply: (s: CalendarEntry[]) => CalendarEntry[],
    save: () => Promise<void>,
    undo: (s: CalendarEntry[]) => CalendarEntry[],
  ) {
    setItems(apply);
    setInFlight((n) => n + 1);
    save()
      .then(() => setSavedOnce(true))
      .catch((e: unknown) => {
        setItems(undo);
        setToast(e instanceof Error && e.message.startsWith('You ') ? e.message : SAVE_ERROR);
      })
      .finally(() => setInFlight((n) => n - 1));
  }

  function move(itemId: string, date: IsoDate) {
    const entry = items.find((x) => x.id === itemId);
    if (!entry || entry.date === date) return;
    const from = entry.date;
    optimistic(
      (s) => s.map((x) => (x.id === itemId ? { ...x, date } : x)),
      () => moveClientWorkout({ workoutId: itemId, date }),
      (s) => s.map((x) => (x.id === itemId ? { ...x, date: from } : x)),
    );
  }

  function remove(entry: CalendarEntry) {
    optimistic(
      (s) => s.filter((x) => x.id !== entry.id),
      () => deleteClientWorkout(entry.id),
      (s) => (s.some((x) => x.id === entry.id) ? s : [...s, entry]),
    );
  }

  function schedule(workout: LibraryWorkout, date: IsoDate, newId: string) {
    const entry: CalendarEntry = { id: newId, name: workout.name, programName: null, date };
    optimistic(
      (s) => (s.some((x) => x.id === newId) ? s : [...s, entry]),
      async () => {
        const outcome = await scheduleWorkout({ newId, workoutId: workout.id, clientId: client.id, date });
        if (!outcome.ok) throw new Error(outcome.error);
      },
      (s) => s.filter((x) => x.id !== newId),
    );
  }

  const days: Record<IsoDate, CalendarItem[]> = {};
  for (const { date, ...item } of items) (days[date] ??= []).push(item);
  const status = inFlight > 0 ? 'Saving…' : savedOnce ? 'All changes saved' : '';

  return (
    <>
      <header className={styles.titleRow}>
        <h1 className={styles.title}>{client.name}</h1>
        <div className={styles.titleActions}>
          <Button onClick={() => setAssigning(true)}>Assign program</Button>
        </div>
      </header>

      <AssignmentsPanel assignments={assignments} today={today} onError={setToast} />

      <p role="status" className={styles.status}>
        {status}
      </p>

      <MonthCalendar
        month={month}
        days={days}
        today={today}
        onDropItem={move}
        onAddToDay={(date) => setPicker({ date, newId: crypto.randomUUID() })}
        renderItem={(item, date) => (
          <ItemMenu
            item={item}
            editHref={`/clients/${client.id}/workouts/${item.id}`}
            onMove={() => setMoving({ ...item, date })}
            onDelete={() => setDeleting({ ...item, date })}
          />
        )}
      />

      {assigning ? (
        <AssignDialog
          clientId={client.id}
          clientName={client.name}
          programs={programs}
          today={today}
          onAssigned={(programName, count) => {
            setAssigning(false);
            setToast(`Assigned ${programName}: ${workoutsText(count)} added.`);
          }}
          onClose={() => setAssigning(false)}
        />
      ) : null}

      {picker ? (
        <WorkoutPicker
          cellLabel={formatShortDay(picker.date)}
          library={library}
          onPick={(w) => {
            schedule(w, picker.date, picker.newId);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}

      {moving ? (
        <MoveDialog
          entry={moving}
          onMove={(date) => {
            move(moving.id, date);
            setMoving(null);
          }}
          onClose={() => setMoving(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteDialog
          entry={deleting}
          clientName={client.name}
          onDelete={() => {
            remove(deleting);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      <div className={styles.toastRegion} aria-live="assertive">
        {toast ? (
          <div className={styles.toast}>
            <span>{toast}</span>
            <button type="button" className={styles.smallButton} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ---------- Assigned programs ---------- */

function AssignmentsPanel({
  assignments,
  today,
  onError,
}: {
  assignments: AssignmentSummary[];
  today: IsoDate;
  onError: (message: string) => void;
}) {
  const headingId = useId();
  const [removing, setRemoving] = useState<AssignmentSummary | null>(null);
  return (
    <Card className={styles.panel}>
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.sectionHeading}>Assigned programs</h2>
        {assignments.length === 0 ? (
          <p className={styles.caption}>No programs assigned. Use Assign program to add one.</p>
        ) : (
          <ul className={styles.assignments}>
            {assignments.map((a) => (
              <li key={a.id} className={styles.assignment}>
                <span className={styles.assignmentName}>
                  {`${a.programName} · ${formatDayMonth(a.startDate)} – ${formatDayMonth(a.endDate)}`}
                </span>
                <Button
                  variant="secondary"
                  aria-label={`Remove ${a.programName} from calendar`}
                  onClick={() => setRemoving(a)}
                >
                  Remove from calendar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {removing ? (
        <UnassignDialog
          assignment={removing}
          today={today}
          onDone={() => setRemoving(null)}
          onError={(message) => {
            setRemoving(null);
            onError(message);
          }}
        />
      ) : null}
    </Card>
  );
}

function UnassignDialog({
  assignment,
  today,
  onDone,
  onError,
}: {
  assignment: AssignmentSummary;
  today: IsoDate;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [pending, setPending] = useState(false);
  const upcoming = assignment.dates.filter((d) => d >= today).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function confirm() {
    if (pending) return;
    setPending(true);
    try {
      // From the coach's own today, as the browser sees it.
      await unassignProgram({ assignmentId: assignment.id, fromDate: today });
      onDone();
    } catch {
      onError("Couldn't remove the program. Please try again.");
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onDone}
    >
      <h2 id={titleId} className={styles.dialogTitle}>Remove {assignment.programName} from the calendar?</h2>
      <p id={bodyId} className={styles.dialogBody}>
        Removes {upcoming} upcoming {upcoming === 1 ? 'workout' : 'workouts'} from {formatShortDay(today)}. Past workouts
        stay.
      </p>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={() => void confirm()} pending={pending}>
          {pending ? 'Removing…' : 'Remove'}
        </Button>
      </div>
    </dialog>
  );
}

/* ---------- One item's menu ---------- */

function ItemMenu({
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

function MoveDialog({ entry, onMove, onClose }: { entry: CalendarEntry; onMove: (date: IsoDate) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [date, setDate] = useState(entry.date);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // The item remounts on its new day: put focus back on it there.
    return () => {
      focusSoon(calendarItemDomId(entry.id));
    };
  }, [entry.id]);

  function submit() {
    const parsed = IsoDateSchema.safeParse(date);
    if (!parsed.success) {
      setError('Pick a date.');
      return;
    }
    onMove(parsed.data);
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Move {entry.name}</h2>
      <p className={styles.dialogBody}>Now on {formatShortDay(entry.date)}.</p>
      <TextField
        label="Date"
        type="date"
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setError(null);
        }}
        {...(error ? { error } : {})}
      />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button onClick={submit}>Move</Button>
      </div>
    </dialog>
  );
}

function DeleteDialog({
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
