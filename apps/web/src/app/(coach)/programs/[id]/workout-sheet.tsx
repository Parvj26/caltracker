'use client';

import { useEffect, useId, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { emptyWorkout, type Units, type WorkoutDoc } from '@caltracker/shared';
import { WorkoutBuilder } from '@/components/workout-builder/workout-builder';
import { Button } from '@/components/ui';
import { saveWorkout, type SaveWorkoutOutcome } from '../../workouts/actions';
import { saveSlotCopy, type SlotWorkout } from '../actions';
import { cellLabel } from './grid-ids';
import type { Slot } from './program-grid';
import styles from '../programs.module.css';

/** What the sheet is for: a new workout for one day, or editing the workout on a placed day. */
export type SheetTarget = { kind: 'new'; week: number; day: number } | { kind: 'edit'; slot: Slot; workout: SlotWorkout };

/** What a save did, so the grid can show it without reloading. */
export type SheetSaved =
  | { kind: 'new'; id: string; name: string; week: number; day: number }
  | { kind: 'everywhere'; id: string; name: string }
  | { kind: 'copy'; slotId: string; id: string; name: string };

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
  programName,
  target,
  units,
  workspaceId,
  onSaved,
  onClose,
}: {
  programName: string;
  target: SheetTarget;
  units: Units;
  workspaceId: string;
  onSaved: (saved: SheetSaved) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [asking, setAsking] = useState<((c: Choice) => void) | null>(null);
  const saved = useRef<SheetSaved | null>(null);
  const [initial] = useState<WorkoutDoc>(() =>
    target.kind === 'new' ? emptyWorkout(() => crypto.randomUUID()) : target.workout.doc,
  );
  const week = target.kind === 'new' ? target.week : target.slot.week;
  const day = target.kind === 'new' ? target.day : target.slot.day;
  const where = cellLabel(week, day);
  const original = target.kind === 'edit' ? target.workout.doc.name : '';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function close() {
    if (dirty) setDiscarding(true);
    else onClose();
  }

  function onCancel(e: SyntheticEvent<HTMLDialogElement>) {
    // Escape: ask before losing changes. (Only the sheet's own cancel, not one from a dialog opened inside it.)
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    close();
  }

  // The builder calls saveWith inside a transition, and React holds a transition's updates until it finishes, which
  // would never happen while this waits for the answer. Yielding once first makes the update an ordinary one.
  const ask = async () => {
    await Promise.resolve();
    return new Promise<Choice>((resolve) => setAsking(() => resolve));
  };
  function answer(c: Choice) {
    asking?.(c);
    setAsking(null);
  }

  async function saveWith(doc: WorkoutDoc): Promise<SaveWorkoutOutcome | null> {
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
        <button type="button" className={styles.closeButton} aria-label="Close" onClick={close}>
          <span aria-hidden="true">✕</span>
        </button>
        <div className={styles.sheetHeading}>
          <span className={styles.eyebrow}>
            {programName} · {where}
          </span>
          <h2 id={titleId} className={styles.dialogTitle}>
            {target.kind === 'new' ? 'New workout' : `Edit ${original}`}
          </h2>
        </div>
      </header>
      {target.kind === 'new' ? (
        <p className={styles.sheetNote}>Saving puts it on {where} and in your Workouts list, then brings you back to the program.</p>
      ) : null}
      <div className={styles.sheetBody}>
        <WorkoutBuilder
          initial={initial}
          units={units}
          workspaceId={workspaceId}
          mode="library"
          isNew={target.kind === 'new'}
          saveLabel={target.kind === 'new' ? 'Save and add to day' : 'Save'}
          saveWith={saveWith}
          onDirtyChange={setDirty}
          onSaved={() => {
            if (saved.current) onSaved(saved.current);
          }}
        />
      </div>

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
              Saves a copy called “{original} (Week {week})” on this day only. Everything else stays the same.
            </span>
          </button>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => answer(null)}>
              Keep editing
            </Button>
          </div>
        </SmallDialog>
      ) : null}

      {discarding ? (
        <SmallDialog title="Discard your changes?" onCancel={() => setDiscarding(false)}>
          <p className={styles.dialogBody}>What you changed here isn’t saved yet.</p>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button onClick={onClose}>Discard</Button>
          </div>
        </SmallDialog>
      ) : null}
    </dialog>
  );
}

/** A small modal question over the sheet. Escape (or Cancel) calls onCancel. */
function SmallDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
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
