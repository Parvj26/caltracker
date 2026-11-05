'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { IsoDateSchema, addDays, isoWeekday, programDayToDate, programEndDate } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { Button, ErrorText, SelectField, TextField } from '@/components/ui';
import { assignProgram } from './actions';
import type { PickerProgram } from './client-calendar';
import styles from '@/components/calendar/calendar.module.css';

/** The Monday after `today` (a week on, when today is a Monday). */
const nextMonday = (today: IsoDate) => addDays(today, 8 - isoWeekday(today));

/** "8 workouts from Mon 9 Nov to Sun 6 Dec": the program's slots inside its length, from the start to its last day. */
export function assignPreview(program: PickerProgram, start: IsoDate): string {
  const dates = program.slots.filter((s) => s.week <= program.weeks).map((s) => programDayToDate(start, s.week, s.day));
  const n = dates.length;
  return `${n} ${n === 1 ? 'workout' : 'workouts'} from ${formatShortDay(start)} to ${formatShortDay(programEndDate(start, program.weeks))}`;
}

/**
 * Assign a program to the client from a start date; the database copies its workouts onto the calendar. The
 * assignment id is made here, once per dialog and per choice of program and date, so a double click or a retry
 * sends the same id and the program is copied only once (Review Focus 4).
 */
export function AssignDialog({
  clientId,
  clientName,
  programs,
  today,
  onAssigned,
  onClose,
}: {
  clientId: string;
  clientName: string;
  programs: PickerProgram[];
  /** The coach's own today, from the browser. */
  today: IsoDate;
  onAssigned: (programName: string, count: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const [startDate, setStartDate] = useState(() => nextMonday(today));
  const [assignmentId, setAssignmentId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const program = programs.find((p) => p.id === programId) ?? null;
  const validStart = IsoDateSchema.safeParse(startDate).success;
  const inPast = validStart && startDate < today;

  /** A different program or date is a different assignment, so it gets its own id. */
  function changed() {
    setAssignmentId(crypto.randomUUID());
    setError(null);
  }

  async function assign() {
    if (busy.current || !program || !validStart) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const outcome = await assignProgram({ assignmentId, programId: program.id, clientId, startDate });
      if (outcome.ok) {
        onAssigned(program.name, outcome.count);
        return;
      }
      setError(outcome.error);
    } catch {
      // The same id is kept, so trying again can't copy the program twice.
      setError("Couldn't assign. Check your connection and try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClose={onClose}
    >
      <h2 id={titleId} className={styles.dialogTitle}>Assign a program</h2>
      {programs.length === 0 ? (
        <p className={styles.dialogBody}>
          You have no programs yet. <Link href="/programs/new">Build a program</Link> first.
        </p>
      ) : (
        <>
          <p className={styles.dialogBody}>Copies the program&apos;s workouts onto {clientName}&apos;s calendar.</p>
          <SelectField
            label="Program"
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value);
              changed();
            }}
          >
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              changed();
            }}
            {...(validStart ? {} : { error: 'Pick a start date.' })}
          />
          {program && validStart ? <p className={styles.preview}>{assignPreview(program, startDate)}</p> : null}
          {inPast ? (
            <p className={styles.pastNote}>
              <span aria-hidden="true" className={styles.pastMarker}>●</span>
              <span>This start date is in the past. Workouts before today will show as missed later.</span>
            </p>
          ) : null}
        </>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
          Cancel
        </Button>
        {programs.length > 0 ? (
          <Button onClick={() => void assign()} pending={pending} disabled={!program || !validStart}>
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
