'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { localDateOf } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { MonthCalendar, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatShortDay } from '@/components/calendar/format';
import { ReloadButton } from '@/components/reload-button';
import { Button } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, isStaleDeployError } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { WorkoutPicker } from '../../programs/[id]/workout-picker';
import { deleteClientWorkout, moveClientWorkout, scheduleWorkout } from './actions';
import { LocalDate } from '../../workouts/local-date';
import { AddWorkoutDialog } from './add-workout-dialog';
import { AssignDialog, type ExistingWorkout } from './assign-dialog';
import { AssignmentsPanel } from './assignments-panel';
import { CalendarEmptyState } from './calendar-empty-state';
import type { ClientRef } from './client';
import { DeleteDialog, ItemMenu, MoveDialog } from './item-menu';
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
/** A workout the client added and finished themselves (a completed log with no planned workout). */
export type ClientLogEntry = { id: string; name: string; finishedAt: string };
export type PickerProgram = { id: string; name: string; weeks: number; slots: { week: number; day: number }[] };
type LibraryWorkout = { id: string; name: string };

const noSubscribe = () => () => {};
/** The browser's time zone, or UTC on the server and during hydration (like useLocalToday). */
const useTimeZone = () => useSyncExternalStore(noSubscribe, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => 'UTC');

const SAVE_ERROR = "Couldn't save that change, so it was undone. Please try again.";
const workoutsText = (n: number) => `${n} ${n === 1 ? 'workout' : 'workouts'}`;
/** Messages from the server that are meant for the coach (anything else gets the generic undo message). */
const forCoach = (message: string) => message.startsWith('You ') || message.startsWith('Pick ') || message.includes('date looks wrong');

/**
 * One client's month: assign a program, add single library workouts ("+ Add workout" or a day's "+"), and move
 * (drag or "Move to…"), edit or delete single workouts. Single workouts go on today or later, so past days are
 * not drag targets: a missed workout can be moved to today or later ("Move to another day") or deleted, and a done
 * one opens its log ("View log") or is deleted (the log stays). Moves and deletes show at once and are undone, with
 * a message, if saving fails; the server re-sends the calendar after every change. A past client's calendar is read-only: no assigning, adding, moving, editing or
 * removing.
 */
export function ClientCalendar({
  client,
  month: monthParam,
  entries,
  clientLogs,
  assignments,
  library,
  programs,
  upcomingWorkouts,
  openAssign = false,
}: {
  client: ClientRef;
  month: string | null;
  entries: CalendarEntry[];
  /** Shown on the day they finished in the coach's zone, as "Added by client", linking to the log. */
  clientLogs: readonly ClientLogEntry[];
  assignments: AssignmentSummary[];
  library: LibraryWorkout[];
  programs: PickerProgram[];
  /** Every workout on the client's calendar from about a week back on (assign warns about days already taken). */
  upcomingWorkouts: readonly ExistingWorkout[];
  /** Open the assign dialog on load (the Assign shortcut on Home, ?assign=1). */
  openAssign?: boolean;
}) {
  const today = useLocalToday();
  const timeZone = useTimeZone();
  const readOnly = client.removedAt !== null;
  const month = monthParam ?? today.slice(0, 7);
  const [items, setItems] = useState(entries);
  const [shown, setShown] = useState(entries);
  if (shown !== entries) {
    // Fresh data from the server (after a save or navigation) replaces the local copy.
    setShown(entries);
    setItems(entries);
  }
  const [assigning, setAssigning] = useState(openAssign && !readOnly);
  // Drop ?assign=1 once it has opened the dialog, so a reload doesn't open it again.
  useEffect(() => {
    if (!openAssign) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('assign')) return;
    url.searchParams.delete('assign');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [openAssign]);
  const [adding, setAdding] = useState(false);
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
    // The reload prompt stays until the coach acts on it.
    if (!toast || toast === STALE_DEPLOY_MESSAGE) return;
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
        if (isStaleDeployError(e)) setToast(STALE_DEPLOY_MESSAGE);
        else setToast(e instanceof Error && forCoach(e.message) ? e.message : SAVE_ERROR);
      })
      .finally(() => setInFlight((n) => n - 1));
  }

  function move(itemId: string, date: IsoDate) {
    const entry = items.find((x) => x.id === itemId);
    if (!entry || entry.date === date || date < today) return;
    const from = entry.date;
    optimistic(
      (s) => s.map((x) => (x.id === itemId ? { ...x, date } : x)),
      async () => {
        const outcome = await moveClientWorkout({ workoutId: itemId, date, today });
        if (!outcome.ok) throw new Error(outcome.error);
      },
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
    const entry: CalendarEntry = { id: newId, name: workout.name, programName: null, logId: null, date };
    optimistic(
      (s) => (s.some((x) => x.id === newId) ? s : [...s, entry]),
      async () => {
        const outcome = await scheduleWorkout({ newId, workoutId: workout.id, clientId: client.id, date, today });
        if (!outcome.ok) throw new Error(outcome.error);
      },
      (s) => s.filter((x) => x.id !== newId),
    );
  }

  const logHref = (logId: string) => `/clients/${client.id}/logs/${logId}`;
  const days: Record<IsoDate, CalendarItem[]> = {};
  for (const { date, ...item } of items) (days[date] ??= []).push(item);
  for (const log of clientLogs) {
    (days[localDateOf(log.finishedAt, timeZone)] ??= []).push({ id: `log-${log.id}`, name: log.name, programName: null, logId: log.id, addedByClient: true });
  }
  const status = inFlight > 0 ? 'Saving…' : savedOnce ? 'All changes saved' : '';
  // Empty: nothing in the month on screen (planned, or added by the client) and no program still running.
  const empty =
    !readOnly &&
    !items.some((x) => x.date.startsWith(`${month}-`)) &&
    !clientLogs.some((l) => localDateOf(l.finishedAt, timeZone).startsWith(`${month}-`)) &&
    !assignments.some((a) => a.endDate >= today);

  return (
    <>
      <header className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>Training</h2>
          {readOnly ? (
            <p className={styles.caption}>
              Past client · removed <LocalDate iso={client.removedAt!} />
            </p>
          ) : (
            <p className={styles.caption}>Assign a program to plan weeks at once, or add a single workout to any day.</p>
          )}
        </div>
        {readOnly ? null : (
          <div className={styles.titleActions}>
            <Button variant="secondary" onClick={() => setAssigning(true)}>
              Assign program
            </Button>
            <Button onClick={() => setAdding(true)}>+ Add workout</Button>
          </div>
        )}
      </header>

      {empty ? (
        <CalendarEmptyState
          firstName={client.firstName}
          onAssign={() => setAssigning(true)}
          onAdd={() => setAdding(true)}
        />
      ) : null}

      <AssignmentsPanel assignments={assignments} today={today} readOnly={readOnly} onMessage={setToast} />

      <p role="status" className={styles.status}>
        {status}
      </p>

      {readOnly ? (
        <MonthCalendar month={month} days={days} today={today} logHref={logHref} renderItem={() => null} />
      ) : (
        <MonthCalendar
          month={month}
          days={days}
          today={today}
          logHref={logHref}
          editableFrom={today}
          onDropItem={move}
          onAddToDay={(date) => setPicker({ date, newId: crypto.randomUUID() })}
          renderItem={(item, date, editable) =>
            editable ? (
              <ItemMenu
                item={item}
                logHref={item.logId ? logHref(item.logId) : undefined}
                editHref={`/clients/${client.id}/workouts/${item.id}`}
                // Done stays on its day (the server refuses moving it too).
                onMove={item.logId ? undefined : () => setMoving({ ...item, date })}
                onDelete={() => setDeleting({ ...item, date })}
              />
            ) : item.logId ? (
              // A past day, done: open its log, or clear it from the calendar (the log stays).
              <ItemMenu item={item} logHref={logHref(item.logId)} onDelete={() => setDeleting({ ...item, date })} />
            ) : (
              // A past day, missed: no editing, but it can be rescheduled to today or later, or cleared.
              <ItemMenu
                item={item}
                onMove={() => setMoving({ ...item, date })}
                moveLabel="Move to another day"
                onDelete={() => setDeleting({ ...item, date })}
              />
            )
          }
        />
      )}

      {assigning ? (
        <AssignDialog
          clientId={client.id}
          clientName={client.name}
          programs={programs}
          existing={upcomingWorkouts}
          today={today}
          onAssigned={(programName, count) => {
            setAssigning(false);
            setToast(`Assigned ${programName}: ${workoutsText(count)} added.`);
          }}
          onClose={() => setAssigning(false)}
        />
      ) : null}

      {adding ? (
        <AddWorkoutDialog
          clientId={client.id}
          library={library}
          today={today}
          onAdded={(workout, date) => {
            setAdding(false);
            setToast(`Added ${workout.name} to ${formatShortDay(date)}.`);
          }}
          onClose={() => setAdding(false)}
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
          today={today}
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
            {toast === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
            <button type="button" className={styles.smallButton} onClick={() => setToast(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
