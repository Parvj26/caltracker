'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import {
  IsoDateSchema,
  earliestProgramStart,
  nextFreeDay,
  nextMonday,
  programClashes,
  programStartError,
  scheduleDateError,
  workoutClashes,
} from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { assignToClients, loadQuickAssign, type QuickAssignData } from '@/app/(coach)/assign/actions';
import { assignPreview } from '@/app/(coach)/clients/[clientId]/assign-dialog';
import { formatShortDay } from '@/components/calendar/format';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, SelectField, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { useLocalToday } from '@/lib/local-today';
import { WorkoutChoices, type ChoiceWorkout } from './workout-choices';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './assign.module.css';

export type QuickAssigned =
  | { kind: 'workout'; message: string; workoutId: string }
  | { kind: 'program'; message: string };

type Tab = 'workout' | 'program';

/**
 * Home's quick Assign for one client, without leaving Home: a Workout tab (pick one and it is added straight away,
 * on the client's next free day unless the coach changes the date first) and a Program tab (start next Monday;
 * days that already have workouts are listed and the button says "Add alongside"). Both save through the same
 * action as the library's Assign, so each copy is made once even after a retry.
 */
export function QuickAssignDialog({
  client,
  onDone,
  onClose,
}: {
  client: { id: string; name: string };
  onDone: (done: QuickAssigned) => void;
  onClose: () => void;
}) {
  const today = useLocalToday();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dateInputId = useId();
  const clashTitleId = useId();
  const [tab, setTab] = useState<Tab>('workout');
  const [data, setData] = useState<QuickAssignData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null: the default (the client's next free day for a workout, next Monday for a program).
  const [workoutDate, setWorkoutDate] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(() => nextMonday(today));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // One id per choice: retrying the same workout and day (or program and start) repeats it, so it's copied once.
  const ids = useRef(new Map<string, string>());
  const idFor = (key: string) => {
    let id = ids.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(key, id);
    }
    return id;
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let live = true;
    loadQuickAssign({ clientId: client.id })
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) setLoadError(failureMessage(e, "Couldn't load your library. Check your connection and try again."));
      });
    return () => {
      live = false;
    };
  }, [client.id]);

  const scheduled = data?.scheduled ?? [];
  const day = workoutDate ?? nextFreeDay(today, scheduled.map((w) => w.date));
  const dayValid = IsoDateSchema.safeParse(day).success;
  const dayError = !dayValid ? 'Pick a date.' : scheduleDateError(day, today);
  const dayClashes = dayError ? [] : workoutClashes(day, scheduled);

  const programs = data?.programs ?? [];
  // Until the coach picks one: the program they assigned most recently, else the first.
  const program = programs.find((p) => p.id === (programId ?? data?.hints.lastProgramId)) ?? programs[0] ?? null;
  const startValid = IsoDateSchema.safeParse(startDate).success;
  const startError = !startValid ? 'Pick a start date.' : programStartError(startDate, today);
  const clashes = program && !startError ? programClashes(program, startDate, scheduled) : [];

  async function save(kind: Tab, sourceId: string, date: IsoDate, name: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const id = idFor(`${kind}|${sourceId}|${date}`);
    try {
      const outcome = await assignToClients({ kind, sourceId, today, targets: [{ clientId: client.id, id, date }] });
      const result = outcome.ok ? outcome.results[0] : null;
      if (!outcome.ok) setError(outcome.error);
      else if (result && !result.ok) setError(result.error);
      else if (kind === 'workout') onDone({ kind, workoutId: id, message: `Added ${name} to ${formatShortDay(date)} for ${client.name}.` });
      else {
        const n = result?.count ?? 0;
        onDone({ kind, message: `Assigned ${name} to ${client.name}: ${n} ${n === 1 ? 'workout' : 'workouts'} added.` });
      }
    } catch (e) {
      // The same choice keeps its id, so trying again can't copy twice.
      setError(failureMessage(e, "Couldn't assign. Check your connection and try again."));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function pickWorkout(w: ChoiceWorkout) {
    if (dayError) return;
    void save('workout', w.id, day, w.name);
  }

  const tabButton = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`${titleId}-${t}`}
      aria-selected={tab === t}
      aria-controls={`${titleId}-${t}-panel`}
      className={tab === t ? styles.tabOn : styles.tab}
      onClick={() => {
        setTab(t);
        setError(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      className={calendar.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId} className={calendar.dialogTitle}>Assign to {client.name}</h2>
      <div role="tablist" aria-label="What to assign" className={styles.tabs}>
        {tabButton('workout', 'Workout')}
        {tabButton('program', 'Program')}
      </div>
      {loadError ? (
        <ErrorText>{loadError}</ErrorText>
      ) : data === null ? (
        <p className={calendar.caption} role="status">Loading…</p>
      ) : tab === 'workout' ? (
        <div role="tabpanel" id={`${titleId}-workout-panel`} aria-labelledby={`${titleId}-workout`} className={styles.panel}>
          <TextField
            label="Date"
            type="date"
            min={today}
            value={day}
            hint={workoutDate === null ? `${client.name}'s next free day. Pick a workout to add it.` : 'Pick a workout to add it.'}
            onChange={(e) => {
              setWorkoutDate(e.target.value);
              setError(null);
            }}
            {...(dayError ? { error: dayError } : {})}
          />
          {dayClashes.length > 0 ? (
            <p className={calendar.pastNote}>
              <span aria-hidden="true" className={calendar.pastMarker}>●</span>
              <span>
                {formatShortDay(day)} already has {dayClashes[0]!.names.join(', ')}. A workout you pick goes alongside it.
              </span>
            </p>
          ) : null}
          <WorkoutChoices library={data.library} hints={data.hints} onPick={pickWorkout} disabled={pending || dayError !== null} />
        </div>
      ) : (
        <div role="tabpanel" id={`${titleId}-program-panel`} aria-labelledby={`${titleId}-program`} className={styles.panel}>
          {programs.length === 0 ? (
            <p className={calendar.dialogBody}>
              You have no programs yet. <Link href="/programs/new">Build a program</Link> first.
            </p>
          ) : (
            <>
              <SelectField
                label="Program"
                value={program?.id ?? ''}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setError(null);
                }}
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                id={dateInputId}
                label="Start date"
                type="date"
                min={earliestProgramStart(today)}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setError(null);
                }}
                {...(startError ? { error: startError } : {})}
              />
              {program && !startError ? <p className={calendar.preview}>{assignPreview(program, startDate)}</p> : null}
              {clashes.length > 0 ? (
                <section className={calendar.clashNote} aria-labelledby={clashTitleId} role="status">
                  <p id={clashTitleId} className={calendar.clashTitle}>
                    <span aria-hidden="true" className={calendar.pastMarker}>●</span>{' '}
                    {clashes.length === 1 ? '1 day already has' : `${clashes.length} days already have`} a workout for {client.name}
                  </p>
                  <ul className={calendar.clashList}>
                    {clashes.map((c) => (
                      <li key={c.date}>
                        {formatShortDay(c.date)}: {c.names.join(', ')}
                      </li>
                    ))}
                  </ul>
                  <p className={calendar.dialogBody}>Pick another start date, or add alongside these. Nothing already there is replaced.</p>
                </section>
              ) : null}
            </>
          )}
        </div>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className={calendar.dialogActions}>
        {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={calendar.smallButton} /> : null}
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
          Cancel
        </Button>
        {tab === 'program' && program ? (
          <Button
            onClick={() => void save('program', program.id, startDate, program.name)}
            pending={pending}
            disabled={startError !== null}
          >
            {pending ? 'Assigning…' : clashes.length > 0 ? 'Add alongside' : 'Assign'}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
