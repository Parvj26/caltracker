'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_CALENDAR_VIEW, calendarRange, localDateOf, stepCalendar, switchAnchor } from '@caltracker/shared';
import { errorMessage, type CalendarView, type IsoDate } from '@caltracker/shared';
import { CalendarToolbar } from '@/components/calendar/calendar-toolbar';
import { MonthCalendar, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatMonth, formatRange, formatShortDay } from '@/components/calendar/format';
import { storeCalendarView, useStoredCalendarView } from '@/components/calendar/stored-view';
import { ReloadButton } from '@/components/reload-button';
import { Button } from '@/components/ui';
import { ActionRefusedError, STALE_DEPLOY_MESSAGE, isStaleDeployError } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { NO_HINTS, type PickerHints } from '@/lib/picker-hints';
import { WorkoutPicker } from '../../programs/[id]/workout-picker';
import { clientWorkoutExists, deleteClientWorkout, moveClientWorkout, scheduleWorkout } from './actions';
import { LocalDate } from '../../workouts/local-date';
import { AssignToClientsDialog } from '@/components/assign/assign-to-clients';
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
/** Refusals worth explaining to the coach; a plain save failure gets the generic undo message. */
const forCoach = (e: unknown): e is ActionRefusedError => e instanceof ActionRefusedError && !e.code.endsWith('_failed');

/**
 * One client's calendar, 1, 2 or 4 weeks or a month at a time (?view=&from=; without ?view= the coach's last pick in
 * this browser, else 2 weeks): assign a program, add single library workouts ("+ Add workout" or a day's "+"), and
 * move (drag or "Move to…"), edit or delete workouts. Single workouts go on today or later, so past days are not drag
 * targets. A workout not yet done can be edited on any day, past ones included (a missed one can also be moved to
 * today or later with "Move to another day"). A done one opens its log; its results are edited there ("Edit
 * results"), and its plan stays as it was so the log still matches it (the server refuses saving it too). Moves and
 * deletes show at once and are undone, with a message, if saving fails; the server re-sends the calendar after every
 * change. A past client's calendar is read-only: no assigning, adding, moving, editing or removing.
 */
export function ClientCalendar({
  client,
  coachId,
  view: viewParam,
  from,
  entries,
  clientLogs,
  assignments,
  library,
  programs,
  upcomingWorkouts,
  hints = NO_HINTS,
  openOnLoad = null,
}: {
  client: ClientRef;
  /** The signed-in coach: the remembered view is theirs. */
  coachId: string;
  /** From ?view=, else the view remembered in a cookie, or null to use localStorage (or the default). */
  view: CalendarView | null;
  /** From ?from= (any day in the range to show), or null for the coach's today. */
  from: IsoDate | null;
  entries: CalendarEntry[];
  /** Shown on the day they finished in the coach's zone, as "Added by client", linking to the log. */
  clientLogs: readonly ClientLogEntry[];
  assignments: AssignmentSummary[];
  library: LibraryWorkout[];
  programs: PickerProgram[];
  /** Every workout on the client's calendar from about a week back on (assign warns about days already taken). */
  upcomingWorkouts: readonly ExistingWorkout[];
  /** The coach's Recent and Most used workouts (pickers show them first) and last-assigned program (the default). */
  hints?: PickerHints;
  /** From ?add= (the Clients list's "+ Workout" and "+ Program"): open that dialog straight away. */
  openOnLoad?: 'workout' | 'program' | null;
}) {
  const today = useLocalToday();
  const timeZone = useTimeZone();
  const readOnly = client.removedAt !== null;
  const pathname = usePathname();
  const storedView = useStoredCalendarView(coachId);
  const view = viewParam ?? storedView ?? DEFAULT_CALENDAR_VIEW;
  const range = calendarRange(view, from ?? today);
  const viewHref = (v: CalendarView, anchor: IsoDate) => `${pathname}?view=${v}&from=${anchor}`;
  const onScreen = (date: IsoDate) => (range.month ? date.startsWith(`${range.month}-`) : date >= range.start && date <= range.end);
  const [items, setItems] = useState(entries);
  const [shown, setShown] = useState(entries);
  if (shown !== entries) {
    // Fresh data from the server (after a save or navigation) replaces the local copy.
    setShown(entries);
    setItems(entries);
  }
  const [assigning, setAssigning] = useState(openOnLoad === 'program' && !readOnly);
  const [adding, setAdding] = useState(openOnLoad === 'workout' && !readOnly);
  // Once opened, drop ?add= from the address, so a reload or Back doesn't open the dialog again.
  useEffect(() => {
    if (!openOnLoad) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('add');
    window.history.replaceState(window.history.state, '', url);
  }, [openOnLoad]);
  const [picker, setPicker] = useState<{ date: IsoDate } | null>(null);
  const [moving, setMoving] = useState<CalendarEntry | null>(null);
  const [deleting, setDeleting] = useState<CalendarEntry | null>(null);
  const [copying, setCopying] = useState<CalendarEntry | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [savedOnce, setSavedOnce] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // The workout the toast can take back ("Added Legs to Mon 9 Nov. Undo"): null for any other message.
  const [undoable, setUndoable] = useState<CalendarEntry | null>(null);
  // Each add's save, by its new id, so Undo waits for the add to land before removing it.
  const saves = useRef(new Map<string, Promise<void>>());
  // Adds that got no clear answer, by "workout id|day": their id, reused if the coach picks the same again.
  const unclear = useRef(new Map<string, string>());
  const say = (message: string | null, undo: CalendarEntry | null = null) => {
    setToast(message);
    setUndoable(undo);
  };

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
    const timer = setTimeout(() => {
      setToast(null);
      setUndoable(null);
    }, 8000);
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
        if (isStaleDeployError(e)) say(STALE_DEPLOY_MESSAGE);
        else say(forCoach(e) ? errorMessage(e.code) : SAVE_ERROR);
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
        if (!outcome.ok) throw new ActionRefusedError(outcome.code);
      },
      (s) => s.map((x) => (x.id === itemId ? { ...x, date: from } : x)),
    );
  }

  function remove(entry: CalendarEntry) {
    // As it is now (Undo's copy is from when it was added; it may have been moved since), so a failed delete puts it
    // back where it now is.
    const current = items.find((x) => x.id === entry.id) ?? entry;
    // An add still saving is removed once it has landed (a failed add has nothing to remove).
    const added = saves.current.get(entry.id) ?? Promise.resolve();
    optimistic(
      (s) => s.filter((x) => x.id !== entry.id),
      () => added.catch(() => undefined).then(() => deleteClientWorkout(entry.id)),
      (s) => (s.some((x) => x.id === entry.id) ? s : [...s, current]),
    );
  }

  /**
   * Adds a library workout on a day at once (saved in the background), with Undo in the toast. When an add gets no
   * clear answer (the connection dropped), it may have landed anyway: the calendar asks the server, and keeps it if it
   * is there. If even that can't be told, the id is kept for that workout and day, so picking it again resends the
   * same id and the database adds it only once.
   */
  function schedule(workout: LibraryWorkout, date: IsoDate) {
    const key = `${workout.id}|${date}`;
    const newId = unclear.current.get(key) ?? crypto.randomUUID();
    const entry: CalendarEntry = { id: newId, name: workout.name, programName: null, logId: null, date };
    optimistic(
      (s) => (s.some((x) => x.id === newId) ? s : [...s, entry]),
      () => {
        const save = (async () => {
          let outcome: Awaited<ReturnType<typeof scheduleWorkout>>;
          try {
            outcome = await scheduleWorkout({ newId, workoutId: workout.id, clientId: client.id, date, today });
          } catch (e) {
            const landed = await clientWorkoutExists(newId).catch(() => null);
            if (landed) {
              unclear.current.delete(key);
              return; // It got through: keep it (the status says saved).
            }
            if (landed === null) unclear.current.set(key, newId);
            else unclear.current.delete(key);
            throw e;
          }
          unclear.current.delete(key);
          if (!outcome.ok) throw new ActionRefusedError(outcome.code);
        })();
        saves.current.set(newId, save);
        return save;
      },
      (s) => s.filter((x) => x.id !== newId),
    );
    say(`Added ${workout.name} to ${formatShortDay(date)}.`, entry);
  }

  const logHref = (logId: string) => `/clients/${client.id}/logs/${logId}`;
  const sessionHref = (workoutId: string) => `/clients/${client.id}/log/${workoutId}`;
  const days: Record<IsoDate, CalendarItem[]> = {};
  for (const { date, ...item } of items) (days[date] ??= []).push(item);
  for (const log of clientLogs) {
    (days[localDateOf(log.finishedAt, timeZone)] ??= []).push({ id: `log-${log.id}`, name: log.name, programName: null, logId: log.id, addedByClient: true });
  }
  const status = inFlight > 0 ? 'Saving…' : savedOnce ? 'All changes saved' : '';
  // Empty: nothing in the days on screen (planned, or added by the client) and no program still running.
  const empty =
    !readOnly &&
    !items.some((x) => onScreen(x.date)) &&
    !clientLogs.some((l) => onScreen(localDateOf(l.finishedAt, timeZone))) &&
    !assignments.some((a) => a.endDate >= today);
  // The month view's padding days belong to other months: it steps from its own 1st.
  const shownFrom = range.month ? `${range.month}-01` : range.start;
  const title = range.month ? formatMonth(range.month) : formatRange(range.start, range.end);
  const grid = {
    weeks: range.weeks,
    month: range.month,
    label: title,
    layout: range.month ? ('month' as const) : ('week' as const),
    days,
    today,
    logHref,
    toolbar: (
      <CalendarToolbar
        view={view}
        title={title}
        todayHref={viewHref(view, today)}
        prevHref={viewHref(view, stepCalendar(view, shownFrom, -1))}
        nextHref={viewHref(view, stepCalendar(view, shownFrom, 1))}
        viewHref={(v) => viewHref(v, switchAnchor(range, today))}
        onPickView={(v) => storeCalendarView(coachId, v)}
      />
    ),
  };

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

      <AssignmentsPanel assignments={assignments} today={today} readOnly={readOnly} onMessage={(m) => say(m)} />

      <p role="status" className={styles.status}>
        {status}
      </p>

      {readOnly ? (
        <MonthCalendar {...grid} itemHref={(item) => (item.logId ? logHref(item.logId) : null)} renderItem={() => null} />
      ) : (
        <MonthCalendar
          {...grid}
          // Clicking a card: a done workout opens its log; any other opens it for editing, on a past day too.
          itemHref={(item) => (item.logId ? logHref(item.logId) : `/clients/${client.id}/workouts/${item.id}`)}
          editableFrom={today}
          onDropItem={move}
          onAddToDay={(date) => setPicker({ date })}
          renderItem={(item, date, editable) =>
            item.logId ? (
              // Done, on any day: open its log or edit its results there, or clear it from the calendar (the log
              // stays). Its plan isn't edited and it isn't moved: the log was done against it, on its day.
              <ItemMenu
                item={item}
                logHref={logHref(item.logId)}
                resultsHref={`${logHref(item.logId)}?edit=1`}
                onCopy={() => setCopying({ ...item, date })}
                onDelete={() => setDeleting({ ...item, date })}
              />
            ) : (
              // Not done: edit it on any day. Today or later moves anywhere from today on; a missed one is
              // rescheduled to today or later.
              <ItemMenu
                item={item}
                // Today's or a missed one: the coach can log it with the client now (not a future day's).
                sessionHref={date <= today ? sessionHref(item.id) : undefined}
                editHref={`/clients/${client.id}/workouts/${item.id}`}
                onMove={() => setMoving({ ...item, date })}
                {...(editable ? {} : { moveLabel: 'Move to another day' })}
                onCopy={() => setCopying({ ...item, date })}
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
          defaultProgramId={hints.lastProgramId}
          existing={upcomingWorkouts}
          today={today}
          onAssigned={(programName, count) => {
            setAssigning(false);
            say(`Assigned ${programName}: ${workoutsText(count)} added.`);
          }}
          onAddWorkout={() => {
            setAssigning(false);
            setAdding(true);
          }}
          onClose={() => setAssigning(false)}
        />
      ) : null}

      {adding ? (
        <AddWorkoutDialog
          library={library}
          hints={hints}
          today={today}
          onPick={(workout, date) => {
            setAdding(false);
            schedule(workout, date);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {picker ? (
        <WorkoutPicker
          cellLabel={formatShortDay(picker.date)}
          library={library}
          hints={hints}
          onPick={(w) => {
            schedule(w, picker.date);
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

      {copying ? (
        // Copy to…: the workout as it is (done ones too, as a fresh plan) onto another day, for this client or others.
        <AssignToClientsDialog
          source={{ kind: 'copy', id: copying.id, name: copying.name, date: copying.date }}
          preselect={[client.id]}
          onDone={(message) => {
            setCopying(null);
            say(message);
          }}
          onClose={() => setCopying(null)}
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
            {undoable ? (
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => {
                  remove(undoable);
                  say(`Removed ${undoable.name}.`);
                }}
              >
                Undo
              </button>
            ) : null}
            <button type="button" className={styles.smallButton} onClick={() => say(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
