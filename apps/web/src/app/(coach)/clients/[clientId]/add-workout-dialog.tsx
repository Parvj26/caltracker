'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { IsoDateSchema, scheduleDateError } from '@caltracker/shared';
import type { IsoDate } from '@caltracker/shared';
import { EmptyLibrary } from '@/components/empty-library';
import { formatShortDay } from '@/components/calendar/format';
import { ReloadButton } from '@/components/reload-button';
import { Button, ErrorText, TextField } from '@/components/ui';
import { STALE_DEPLOY_MESSAGE, failureMessage } from '@/lib/action-errors';
import { matchesSearch } from '../../programs/[id]/search';
import { scheduleWorkout } from './actions';
import styles from '@/components/calendar/calendar.module.css';

type LibraryWorkout = { id: string; name: string };

/**
 * "+ Add workout": one library workout on one day (today or later). The new workout's id is made once each time the
 * dialog opens, so a double click or a retry adds it only once.
 */
export function AddWorkoutDialog({
  clientId,
  library,
  today,
  onAdded,
  onClose,
}: {
  clientId: string;
  library: LibraryWorkout[];
  /** The coach's own today, from the browser. */
  today: IsoDate;
  onAdded: (workout: LibraryWorkout, date: IsoDate) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<LibraryWorkout | null>(null);
  const [date, setDate] = useState<string>(today);
  const [newId] = useState(() => crypto.randomUUID());
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

  const parsed = IsoDateSchema.safeParse(date);
  const dateError = !parsed.success ? 'Pick a date.' : scheduleDateError(parsed.data, today);
  const results = library.filter((w) => matchesSearch(w.name, query));

  async function add() {
    if (busy.current || !picked || !parsed.success || dateError) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const outcome = await scheduleWorkout({ newId, workoutId: picked.id, clientId, date: parsed.data, today });
      if (outcome.ok) {
        onAdded(picked, parsed.data);
        return;
      }
      setError(outcome.error);
    } catch (e) {
      // The same id is kept, so trying again can't add it twice.
      setError(failureMessage(e, "Couldn't add the workout. Check your connection and try again."));
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
      <h2 id={titleId} className={styles.dialogTitle}>Add a workout</h2>
      {library.length === 0 ? (
        <EmptyLibrary className={styles.dialogBody} />
      ) : (
        <>
          <label className={styles.searchLabel}>
            <span>Search workouts</span>
            <input
              type="search"
              className={styles.input}
              value={query}
              aria-controls={resultsId}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul id={resultsId} className={styles.results} aria-label="Library workouts">
            {results.length === 0 ? <li className={styles.caption}>No workouts match.</li> : null}
            {results.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  className={styles.result}
                  aria-pressed={picked?.id === w.id}
                  onClick={() => {
                    setPicked(w);
                    setError(null);
                  }}
                >
                  <span>{w.name}</span>
                  {picked?.id === w.id ? <span aria-hidden="true">✓</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <TextField
            label="Date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setError(null);
            }}
            {...(dateError ? { error: dateError } : {})}
          />
          {picked && !dateError && parsed.success ? (
            <p className={styles.preview}>
              {picked.name} on {formatShortDay(parsed.data)}
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
        {library.length > 0 ? (
          <Button onClick={() => void add()} pending={pending} disabled={!picked || dateError !== null}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
