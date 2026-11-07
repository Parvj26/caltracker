'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DEFAULT_CALENDAR_VIEW, calendarRange, localDateOf, stepCalendar, switchAnchor } from '@caltracker/shared';
import type { CalendarView, IsoDate } from '@caltracker/shared';
import { CalendarToolbar } from '@/components/calendar/calendar-toolbar';
import { MonthCalendar, type CalendarItem } from '@/components/calendar/month-calendar';
import { formatMonth, formatRange, formatShortDay } from '@/components/calendar/format';
import { storeCalendarView, useStoredCalendarView } from '@/components/calendar/stored-view';
import { ReloadButton } from '@/components/reload-button';
import { Button, ButtonLink } from '@/components/ui';
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
  openAssign = false,
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
  /** Open the assign dialog on load (the Assign shortcut on Home, ?assign=1). */
  openAssign?: boolean;
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
            <ButtonLink variant="secondary" href={`/messages/${client.id}`}>
              Message
            </ButtonLink>
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
        <MonthCalendar {...grid} itemHref={(item) => (item.logId ? logHref(item.logId) : null)} renderItem={() => null} />
      ) : (
        <MonthCalendar
          {...grid}
          // Clicking a card: a done workout opens its log; any other opens it for editing, on a past day too.
          itemHref={(item) => (item.logId ? logHref(item.logId) : `/clients/${client.id}/workouts/${item.id}`)}
          editableFrom={today}
          onDropItem={move}
          onAddToDay={(date) => setPicker({ date, newId: crypto.randomUUID() })}
          renderItem={(item, date, editable) =>
            item.logId ? (
              // Done, on any day: open its log or edit its results there, or clear it from the calendar (the log
              // stays). Its plan isn't edited and it isn't moved: the log was done against it, on its day.
              <ItemMenu
                item={item}
                logHref={logHref(item.logId)}
                resultsHref={`${logHref(item.logId)}?edit=1`}
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
