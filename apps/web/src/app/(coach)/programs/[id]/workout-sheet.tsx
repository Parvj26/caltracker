'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { IsoDateSchema, emptyWorkout, scheduleDateError, type ExercisePrefs, type IsoDate, type Units, type WorkoutDoc } from '@caltracker/shared';
import { QuickDayPicker } from '@/components/assign/quick-day-picker';
import { formatShortDay } from '@/components/calendar/format';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { Button } from '@/components/ui';
import ad from '@/components/ui/adaptive-dialog.module.css';
import { cx } from '@/components/ui/cx';
import { saveWorkout, type SaveWorkoutOutcome } from '../../workouts/actions';
import { saveSlotCopy, type SlotWorkout } from '../actions';
import { createClientWorkout } from '../../clients/[clientId]/actions';
import { cellLabel, copyDaySuffix } from './grid-ids';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';
import { openLayer } from '@/lib/open-layer';
import { FlagReminderLoader } from '@/components/flags/flag-reminder';

/**
 * What the sheet is for: a new workout for one program day, editing the workout on a placed day, or a new workout
 * for one client's calendar day ("+ New workout" in the client's "Add a workout" window).
 */
export type SheetTarget =
  | { kind: 'new'; week: number; day: number }
  | { kind: 'edit'; slot: Slot; workout: SlotWorkout }
  | { kind: 'client'; clientId: string; clientName: string; date: IsoDate; today: IsoDate }
  /**
   * The suggested corrective workout from an assessment (board AS5b): opens filled in, and "Assign to client" asks for
   * the day (the same quick days as "+ Add workout") before it goes on that client's calendar.
   */
  | { kind: 'suggested'; clientId: string; clientName: string; today: IsoDate; doc: WorkoutDoc };

/** What a save did, so the grid can show it without reloading. */
export type SheetSaved =
  | { kind: 'new'; id: string; name: string; week: number; day: number }
  | { kind: 'everywhere'; id: string; name: string }
  | { kind: 'copy'; slotId: string; id: string; name: string }
  | { kind: 'client'; id: string; name: string; date: IsoDate; library: boolean };

type Choice = 'everywhere' | 'copy' | null;

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** True when saving the workout can only change this one program day (no question needed). */
export function onlyThisDay(w: Pick<SlotWorkout, 'daysInProgram' | 'otherPrograms' | 'invitePlans'>): boolean {
  return w.daysInProgram <= 1 && w.otherPrograms === 0 && w.invitePlans === 0;
}

/** "“Upper” is used on 2 days in Iron Man and in 1 other program." */
export function usedWhere(name: string, program: string, w: Pick<SlotWorkout, 'daysInProgram' | 'otherPrograms' | 'invitePlans'>): string {
  const places = [`on ${count(w.daysInProgram, 'day')} in ${program}`];
  if (w.otherPrograms > 0) places.push(`in ${count(w.otherPrograms, 'other program')}`);
  if (w.invitePlans > 0) places.push(`in ${count(w.invitePlans, 'invite plan')}`);
  const last = places.pop()!;
  return `“${name}” is used ${places.length > 0 ? `${places.join(', ')} and ${last}` : last}.`;
}

/**
 * The workout editor in a large sheet over the program (full screen on a phone): a new workout for a day ("Save and
 * add to day" saves it to Workouts and puts it on the day), or the workout on a placed day. Saving an edit to a
 * workout used anywhere else first asks whether the change goes everywhere or only on this day. Closing with unsaved
 * changes asks first.
 */
export function WorkoutSheet({
  programName = '',
  target,
  units,
  workspaceId,
  exercisePrefs,
  onSaved,
  onClose,
}: {
  /** The program's name (program days only). */
  programName?: string;
  target: SheetTarget;
  units: Units;
  workspaceId: string;
  exercisePrefs: Record<string, ExercisePrefs>;
  onSaved: (saved: SheetSaved) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const discardId = useId();
  const discardRef = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [asking, setAsking] = useState<((c: Choice) => void) | null>(null);
  const [askingDay, setAskingDay] = useState<((d: IsoDate | null) => void) | null>(null);
  const saved = useRef<SheetSaved | null>(null);
  const [initial] = useState<WorkoutDoc>(() =>
    target.kind === 'edit' ? target.workout.doc : target.kind === 'suggested' ? target.doc : emptyWorkout(() => crypto.randomUUID()),
  );
  // A client's new workout: "Also save to Library" (off to start with), and the calendar copy's id when it is ticked
  // (made once, so a retry adds it only once).
  const [alsoLibrary, setAlsoLibrary] = useState(false);
  const [calendarId] = useState(() => crypto.randomUUID());
  const [libraryId] = useState(() => crypto.randomUUID());
  const week = target.kind === 'new' ? target.week : target.kind === 'edit' ? target.slot.week : 0;
  const day = target.kind === 'new' ? target.day : target.kind === 'edit' ? target.slot.day : 0;
  const where = target.kind === 'client' ? formatShortDay(target.date) : target.kind === 'suggested' ? 'Suggested' : cellLabel(week, day);
  const forClient = target.kind === 'client' || target.kind === 'suggested';
  const original = target.kind === 'edit' ? target.workout.doc.name : '';
  const isNew = target.kind !== 'edit';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog) openLayer(dialog);
  }, []);

  // The question takes focus, so a keyboard or screen reader user meets it.
  useEffect(() => {
    if (discarding) discardRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [discarding]);

  function close() {
    if (dirty) setDiscarding(true);
    else onClose();
  }

  function onCancel(e: SyntheticEvent<HTMLDialogElement>) {
    // Escape: ask before losing changes. (Only the sheet's own cancel, not one from a dialog opened inside it.)
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    // A second Escape while asking means "keep editing".
    if (discarding) setDiscarding(false);
    else close();
  }

  // The builder calls saveWith inside a transition, and React holds a transition's updates until it finishes, which
  // would never happen while this waits for the answer. Yielding once first makes the update an ordinary one.
  const ask = async () => {
    await Promise.resolve();
    return new Promise<Choice>((resolve) => setAsking(() => resolve));
  };
  const askDay = async () => {
    await Promise.resolve();
    return new Promise<IsoDate | null>((resolve) => setAskingDay(() => resolve));
  };
  function answerDay(d: IsoDate | null) {
    askingDay?.(d);
    setAskingDay(null);
  }
  function answer(c: Choice) {
    asking?.(c);
    setAsking(null);
  }

  /**
   * The top bar's Save (phones): presses the editor's Save, so checks, messages and the "where does this edit go?"
   * question are all the same. The keyboard closes first, so a message beside Save can be seen. Found by its label
   * alone: the editor's Save moved from a bottom bar to the top on phones, so a selector naming the bar broke.
   */
  function saveFromTop() {
    (document.activeElement as HTMLElement | null)?.blur();
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-ph-capture-attribute-label="workout_save"]')?.click();
  }

  async function saveWith(doc: WorkoutDoc): Promise<SaveWorkoutOutcome | null> {
    if (target.kind === 'suggested') {
      const date = await askDay();
      if (date === null) return null;
      const outcome = await createClientWorkout({ doc, clientId: target.clientId, date, today: target.today, alsoLibrary, newId: calendarId, libraryId });
      if (outcome.ok) saved.current = { kind: 'client', id: outcome.id, name: doc.name, date, library: alsoLibrary };
      return outcome;
    }
    if (target.kind === 'client') {
      const outcome = await createClientWorkout({
        doc,
        clientId: target.clientId,
        date: target.date,
        today: target.today,
        alsoLibrary,
        newId: calendarId,
        libraryId,
      });
      if (outcome.ok) saved.current = { kind: 'client', id: outcome.id, name: doc.name, date: target.date, library: alsoLibrary };
      return outcome;
    }
    if (target.kind === 'new') {
      const outcome = await saveWorkout(doc);
      if (outcome.ok) saved.current = { kind: 'new', id: outcome.id, name: doc.name, week, day };
      return outcome;
    }
    const choice: Choice = onlyThisDay(target.workout) ? 'everywhere' : await ask();
    if (choice === null) return null;
    if (choice === 'everywhere') {
      const outcome = await saveWorkout(doc);
      if (outcome.ok) saved.current = { kind: 'everywhere', id: outcome.id, name: doc.name };
      return outcome;
    }
    const outcome = await saveSlotCopy({ slotId: target.slot.id, doc });
    if (!outcome.ok) return outcome;
    saved.current = { kind: 'copy', slotId: target.slot.id, id: outcome.id, name: outcome.name };
    return { ok: true, id: outcome.id };
  }

  return (
    <dialog ref={dialogRef} className={styles.sheet} aria-labelledby={titleId} onCancel={onCancel}
      // A dialog opened inside the sheet (the exercise picker, a question) closing is not the sheet closing.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className={styles.sheetHeader}>
        <div className={styles.sheetHeading}>
          <span className={styles.eyebrow}>
            {forClient ? target.clientName : programName} · {where}
          </span>
          <h2 id={titleId} className={styles.dialogTitle}>
            {target.kind === 'suggested' ? 'Suggested workout' : isNew ? 'New workout' : `Edit ${original}`}
          </h2>
        </div>
        {forClient ? (
          // Off to start with: a workout made for one client stays theirs unless the coach wants it in the Library too.
          <label className={styles.sheetLibraryToggle}>
            <input type="checkbox" checked={alsoLibrary} onChange={(e) => setAlsoLibrary(e.target.checked)} data-ph-capture-attribute-label="client_new_workout_library" />
            <span>Also save to Library</span>
          </label>
        ) : null}
        {/* Phones only (CSS) on a program: wider screens keep the editor's own save bar in view. A client's new workout
            keeps Save here on every size, beside "Also save to Library". */}
        <Button
          className={cx(styles.sheetTopSave, forClient && styles.sheetTopSaveAlways)}
          onClick={saveFromTop}
          data-ph-capture-attribute-label={target.kind === 'suggested' ? 'suggested_workout_assign' : target.kind === 'client' ? 'client_new_workout_save' : 'program_sheet_top_save'}
        >
          {target.kind === 'suggested' ? 'Assign to client' : 'Save'}
        </Button>
        {/* The one close style (rulebook §5.2): a 44 px grey circle with ×, top right. */}
        <button type="button" className={ad.close} aria-label="Close" onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {discarding ? (
        // The standard inline "Discard changes?" step (as in AdaptiveDialog), not a second dialog over the sheet.
        <div ref={discardRef} className={cx(ad.discard, styles.sheetDiscard)} role="group" aria-labelledby={discardId}>
          <p id={discardId} className={ad.discardText} data-ph-safe="">
            <strong>Discard changes?</strong> What you changed here isn’t saved yet.
          </p>
          <div className={ad.discardActions}>
            <Button variant="secondary" size="compact" onClick={() => setDiscarding(false)} phSafe>
              Keep editing
            </Button>
            <Button variant="danger" size="compact" onClick={onClose} phSafe>
              Discard
            </Button>
          </div>
        </div>
      ) : null}
      {/* A workout for one client: their open flags under the title (board AS10). */}
      {forClient ? <FlagReminderLoader clientId={target.clientId} /> : null}
      {target.kind === 'suggested' ? (
        <p className={styles.sheetNote}>{countExercises(target.doc)} · sets and reps filled in from each exercise’s default. Nothing reaches {target.clientName} until you assign it.</p>
      ) : null}
      {target.kind === 'new' ? (
        <p className={styles.sheetNote}>Saving puts it on {where} and in your Workouts list, then brings you back to the program.</p>
      ) : null}
      <div className={styles.sheetBody}>
        <WorkoutBuilder
          initial={initial}
          units={units}
          workspaceId={workspaceId}
          mode="library"
          isNew={isNew}
          initialPrefs={exercisePrefs}
          saveLabel={target.kind === 'new' ? 'Save and add to day' : target.kind === 'suggested' ? 'Assign to client' : 'Save'}
          {...(forClient ? { hideWideSave: true } : {})}
          saveWith={saveWith}
          onDirtyChange={setDirty}
          embedded
          onSaved={() => {
            if (saved.current) onSaved(saved.current);
          }}
        />
      </div>

      {askingDay && target.kind === 'suggested' ? (
        <DayDialog clientName={target.clientName} today={target.today} onAnswer={answerDay} />
      ) : null}

      {asking ? (
        <SmallDialog title={`Save changes to “${original}”?`} onCancel={() => answer(null)}>
          <p className={styles.dialogBody}>
            You opened it from {where}. {target.kind === 'edit' ? usedWhere(original, programName, target.workout) : ''}
          </p>
          <button type="button" className={styles.bigChoice} onClick={() => answer('everywhere')}>
            <span className={styles.bigChoiceTitle}>Update everywhere</span>
            <span className={styles.bigChoiceSub}>Every day and program that uses “{original}” gets these changes.</span>
          </button>
          <button type="button" className={`${styles.bigChoice} ${styles.bigChoiceAlt}`} onClick={() => answer('copy')}>
            <span className={styles.bigChoiceTitle}>Just {where}</span>
            <span className={styles.bigChoiceSub}>
              Saves a copy called “{original}{copyDaySuffix(week, day)}” on this day only. Everything else stays the same.
            </span>
          </button>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => answer(null)}>
              Keep editing
            </Button>
          </div>
        </SmallDialog>
      ) : null}

    </dialog>
  );
}

const countExercises = (doc: WorkoutDoc) => {
  const n = doc.blocks.reduce((sum, b) => sum + b.exercises.length, 0);
  return `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
};

/** "Assign to <client>": the day (quick days or Pick a date…), then Assign · <day>. A question over the sheet. */
function DayDialog({ clientName, today, onAnswer }: { clientName: string; today: IsoDate; onAnswer: (d: IsoDate | null) => void }) {
  const [date, setDate] = useState<string>(today);
  const parsed = IsoDateSchema.safeParse(date);
  const error = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);
  return (
    <SmallDialog title={`Assign to ${clientName}`} onCancel={() => onAnswer(null)}>
      <QuickDayPicker legend="Day" today={today} value={date} onChange={setDate} fieldMin={today} error={error} />
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => onAnswer(null)}>
          Cancel
        </Button>
        <Button
          aria-disabled={error !== null}
          data-testid="assign-day-confirm"
          onClick={() => {
            if (error === null && parsed.success) onAnswer(parsed.data);
          }}
        >
          Assign · {parsed.success ? formatShortDay(parsed.data) : '…'}
        </Button>
      </div>
    </SmallDialog>
  );
}

/** A small modal question over the sheet. Escape (or Cancel) calls onCancel. */
function SmallDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d) openLayer(d);
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }}
    >
      <h2 id={titleId} className={styles.dialogTitle}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
