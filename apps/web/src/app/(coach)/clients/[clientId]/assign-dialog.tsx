'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import {
  IsoDateSchema,
  addDays,
  earliestProgramStart,
  isoWeekday,
  programDayToDate,
  programEndDate,
  programStartError,
} from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { formatShortDay } from '@/components/calendar/format';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, SelectField, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
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
 * assignment id is made once each time the dialog opens, so a double click or a retry sends the same id and the
 * program is copied only once (Review Focus 4). If a first try did go through and the coach then changes the program
 * or date, the database refuses the reused id (23505) and the coach is told, instead of getting a second copy.
 * A program can start up to 7 days back (for a client who already began); the server checks the same.
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
  const [assignmentId] = useState(() => crypto.randomUUID());
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
  const startError = !validStart ? 'Pick a start date.' : programStartError(startDate, today);
  const inPast = startError === null && startDate < today;

  async function assign() {
    if (busy.current || !program || startError) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const outcome = await assignProgram({ assignmentId, programId: program.id, clientId, startDate, today });
      if (outcome.ok) {
        onAssigned(program.name, outcome.count);
        return;
      }
      setError(outcome.error);
    } catch (e) {
      // The same id is kept, so trying again can't copy the program twice.
      setError(failureMessage(e, "Couldn't assign. Check your connection and try again."));
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
          {program && startError === null ? <p className={styles.preview}>{assignPreview(program, startDate)}</p> : null}
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
        {error === STALE_DEPLOY_MESSAGE ? <ReloadButton className={styles.smallButton} /> : null}
        <Button variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>
          Cancel
        </Button>
        {programs.length > 0 ? (
          <Button onClick={() => void assign()} pending={pending} disabled={!program || startError !== null}>
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
