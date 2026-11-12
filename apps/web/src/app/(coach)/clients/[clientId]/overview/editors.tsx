'use client';

import type { ErrorCode } from '@caltracker/shared';
import { useId, useRef, useState, useTransition } from 'react';
import { GOAL_MAX_LENGTH, NOTE_MAX_LENGTH, countdownLabel, type IsoDate } from '@caltracker/shared';
import { LocalDate } from '@/app/(coach)/workouts/local-date';
import { Button, Card, ErrorText, TextAreaField, TextField } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import type { OverviewNote } from '@/lib/client-overview';
import { addNote, clearGoal, deleteNote, saveGoal, saveLimitations, updateNote, type RecordOutcome } from '../overview-actions';
import styles from '../client-page.module.css';

/** Runs a save, keeps the button busy meanwhile, and turns a failure (or a dropped connection) into a message. */
function useSave() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<ErrorCode | null>(null);
  function run(action: () => Promise<RecordOutcome>, onDone: () => void) {
    setError(null);
    start(async () => {
      try {
        const outcome = await action();
        if (outcome.ok) onDone();
        else setError(outcome.code);
      } catch (e) {
        setError(failureCode(e, 'save_offline'));
      }
    });
  }
  return { pending, error, run, clear: () => setError(null) };
}

export function GoalCard({
  clientId,
  firstName,
  goal,
  today,
  readOnly,
}: {
  clientId: string;
  firstName: string;
  goal: { goal: string; targetDate: IsoDate | null } | null;
  today: IsoDate;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(goal?.goal ?? '');
  const [date, setDate] = useState(goal?.targetDate ?? '');
  const save = useSave();
  const editButton = useRef<HTMLButtonElement>(null);

  function open() {
    setText(goal?.goal ?? '');
    setDate(goal?.targetDate ?? '');
    save.clear();
    setEditing(true);
  }
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };

  return (
    <Card className={styles.card} aria-labelledby="goal-heading">
      <div className={styles.cardHead}>
        <h2 id="goal-heading" className={styles.heading}>Goal &amp; countdown</h2>
        {readOnly || editing ? null : (
          <button ref={editButton} type="button" className={styles.textButton} onClick={open} aria-label={goal ? 'Edit goal' : 'Set a goal'}>
            {goal ? 'Edit' : 'Set goal'}
          </button>
        )}
      </div>
      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            save.run(() => saveGoal(clientId, text, date || null), close);
          }}
        >
          <TextField label="Goal" value={text} onChange={(e) => setText(e.target.value)} maxLength={GOAL_MAX_LENGTH} required autoFocus placeholder="Run the Dubai half marathon" />
          <TextField label="Target date (optional)" type="date" value={date} onChange={(e) => setDate(e.target.value)} min="2000-01-01" />
          {save.error ? <ErrorText code={save.error} /> : null}
          <div className={styles.actions}>
            <Button type="submit" pending={save.pending}>{save.pending ? 'Saving…' : 'Save goal'}</Button>
            <Button variant="secondary" onClick={close} disabled={save.pending}>Cancel</Button>
            {goal ? (
              <button type="button" className={styles.textButton} disabled={save.pending} onClick={() => save.run(() => clearGoal(clientId), close)}>
                Remove goal
              </button>
            ) : null}
          </div>
        </form>
      ) : goal ? (
        <>
          {goal.targetDate ? (
            <p className={styles.countdown} aria-label={`${countdownLabel(goal.targetDate, today)}, target ${goal.targetDate}`}>
              {countdownLabel(goal.targetDate, today)}
            </p>
          ) : null}
          <p className={styles.goalText}>{goal.goal}</p>
          {goal.targetDate ? <p className={styles.caption}>Target date: <LocalDate iso={`${goal.targetDate}T12:00:00Z`} /></p> : null}
        </>
      ) : (
        <p className={styles.caption}>No goal yet.</p>
      )}
      <p className={styles.caption}>Shared with {firstName}.</p>
    </Card>
  );
}

export function LimitationsCard({ clientId, body, readOnly }: { clientId: string; body: string; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const save = useSave();
  const editButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  return (
    <Card id="limitations" tabIndex={-1} className={styles.card} aria-labelledby="limitations-heading">
      <div className={styles.cardHead}>
        <h2 id="limitations-heading" className={styles.heading}>Limitations &amp; injuries</h2>
        {readOnly || editing ? null : (
          <button
            ref={editButton}
            type="button"
            className={styles.textButton}
            aria-label="Edit limitations and injuries"
            onClick={() => {
              setText(body);
              save.clear();
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            save.run(() => saveLimitations(clientId, text), close);
          }}
        >
          <TextAreaField
            label="Limitations and injuries"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={5}
            autoFocus
            placeholder="Left knee: no deep squats. Lower back: avoid heavy deadlifts."
          />
          {save.error ? <ErrorText code={save.error} /> : null}
          <div className={styles.actions}>
            <Button type="submit" pending={save.pending}>{save.pending ? 'Saving…' : 'Save'}</Button>
            <Button variant="secondary" onClick={close} disabled={save.pending}>Cancel</Button>
          </div>
        </form>
      ) : body.trim() ? (
        <p className={styles.body}>{body}</p>
      ) : (
        <p className={styles.caption}>Nothing noted.</p>
      )}
      <p className={styles.caption}>Only you can see this.</p>
    </Card>
  );
}

function NoteItem({ note, readOnly }: { note: OverviewNote; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(note.body);
  const save = useSave();
  const labelId = useId();
  const edited = note.updatedAt.slice(0, 19) !== note.createdAt.slice(0, 19);
  return (
    <li className={styles.note} aria-labelledby={labelId}>
      <span id={labelId} className={styles.caption}>
        <LocalDate iso={note.createdAt} />
        {edited ? ' · edited' : ''}
      </span>
      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            save.run(() => updateNote(note.id, text), () => setEditing(false));
          }}
        >
          <TextAreaField label="Edit note" value={text} onChange={(e) => setText(e.target.value)} maxLength={NOTE_MAX_LENGTH} rows={3} autoFocus />
          {save.error ? <ErrorText code={save.error} /> : null}
          <div className={styles.actions}>
            <Button type="submit" pending={save.pending}>{save.pending ? 'Saving…' : 'Save'}</Button>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={save.pending}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className={styles.body}>{note.body}</p>
      )}
      {readOnly || editing ? null : confirming ? (
        <div className={styles.actions} role="group" aria-label="Delete this note?">
          <span className={styles.caption}>Delete this note?</span>
          <button type="button" className={styles.textButton} disabled={save.pending} onClick={() => save.run(() => deleteNote(note.id), () => setConfirming(false))}>
            {save.pending ? 'Deleting…' : 'Delete'}
          </button>
          <button type="button" className={styles.textButton} onClick={() => setConfirming(false)}>Keep</button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setText(note.body);
              save.clear();
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button type="button" className={styles.textButton} onClick={() => setConfirming(true)}>Delete</button>
        </div>
      )}
      {!editing && save.error ? <ErrorText code={save.error} /> : null}
    </li>
  );
}

export function NotesCard({ clientId, notes, readOnly }: { clientId: string; notes: OverviewNote[]; readOnly: boolean }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const save = useSave();
  return (
    <Card className={styles.card} aria-labelledby="notes-heading">
      <h2 id="notes-heading" className={styles.heading}>Notes</h2>
      <p className={styles.caption}>Only you can see these.</p>
      {readOnly ? null : (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            setStatus('');
            save.run(() => addNote(clientId, text), () => {
              setText('');
              setStatus('Note added.');
            });
          }}
        >
          <TextAreaField label="New note" value={text} onChange={(e) => setText(e.target.value)} maxLength={NOTE_MAX_LENGTH} rows={3} placeholder="Prefers morning sessions." />
          {save.error ? <ErrorText code={save.error} /> : null}
          <div className={styles.actions}>
            <Button type="submit" variant="secondary" pending={save.pending} disabled={!text.trim()}>
              {save.pending ? 'Adding…' : 'Add note'}
            </Button>
          </div>
          <p role="status" className={styles.status}>{status}</p>
        </form>
      )}
      {notes.length === 0 ? (
        <p className={styles.caption}>No notes yet.</p>
      ) : (
        <ul className={styles.notes} aria-label="Notes, newest first">
          {notes.map((n) => (
            <NoteItem key={`${n.id}-${n.updatedAt}`} note={n} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </Card>
  );
}
