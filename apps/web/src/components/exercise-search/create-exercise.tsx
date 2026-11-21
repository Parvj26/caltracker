'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LIBRARY_TRACKING_TYPES, findNearDuplicate, type ErrorCode, type ExerciseIndexRow, type LibraryTrackingType } from '@caltracker/shared';
import { quickCreateExercise } from '@/app/(coach)/exercises/actions';
import { TRACKING_LABELS } from '@/app/(coach)/exercises/filters';
import { failureCode } from '@/lib/action-errors';
import { Button, ErrorText, SelectField, TextField } from '@/components/ui';
import styles from './exercise-search.module.css';

/** "sandbag carry" -> "Sandbag carry": the name the form starts with. */
export const nameFromQuery = (query: string) => {
  const t = query.trim().replace(/\s+/g, ' ');
  return t.charAt(0).toLocaleUpperCase('en') + t.slice(1);
};

export type CreatedExercise = { id: string; name: string; trackingType: LibraryTrackingType };

/**
 * The search found nothing: a lime "+ Create '<query>'" button, then a short form in place (name, tracking type) that
 * creates a custom exercise for this workspace without leaving the picker. When a near-identical exercise already
 * exists (case and spaces ignored), it asks "Did you mean …?" with "Use it" first.
 */
export function CreateFromSearch({
  query,
  rows,
  onCreated,
  onUse,
}: {
  query: string;
  /** Every exercise the search knows (built-ins and this workspace's own), for "Did you mean …?". */
  rows: readonly ExerciseIndexRow[];
  onCreated: (created: CreatedExercise) => void;
  /** "Use it": the existing exercise instead. */
  onUse: (row: ExerciseIndexRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => nameFromQuery(query));
  const [trackingType, setTrackingType] = useState<LibraryTrackingType>('reps');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  // A new search starts over with its own name.
  const [shownFor, setShownFor] = useState(query);
  if (shownFor !== query) {
    setShownFor(query);
    setName(nameFromQuery(query));
    setOpen(false);
    setError(null);
  }
  useEffect(() => {
    if (open) formRef.current?.querySelector('input')?.focus();
  }, [open]);

  const near = findNearDuplicate(name, rows);
  const label = nameFromQuery(query);

  if (!open) {
    return (
      <Button variant="create" onClick={() => setOpen(true)} data-ph-capture-attribute-label="exercise_search_create_open" className={styles.createButton}>
        {`+ Create “${label}”`}
      </Button>
    );
  }

  async function create() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const outcome = await quickCreateExercise({ name, trackingType });
      if (outcome.ok) onCreated({ id: outcome.id, name: outcome.name, trackingType: outcome.trackingType });
      else setError(outcome.code);
    } catch (e) {
      setError(failureCode(e, 'exercise_create_failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      className={styles.createForm}
      aria-labelledby={headingId}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <h3 id={headingId} className={styles.visuallyHidden}>
        Create an exercise
      </h3>
      {near ? (
        <div className={styles.didYouMean} role="status">
          <span>
            Did you mean <b>{near.name}</b>?
          </span>
          <Button variant="secondary" size="compact" onClick={() => onUse(near)} data-ph-capture-attribute-label="exercise_search_create_use_existing">
            Use it
          </Button>
        </div>
      ) : null}
      <TextField label="Name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <SelectField label="Tracking" value={trackingType} onChange={(e) => setTrackingType(e.target.value as LibraryTrackingType)}>
        {LIBRARY_TRACKING_TYPES.map((t) => (
          <option key={t} value={t}>
            {TRACKING_LABELS[t]}
          </option>
        ))}
      </SelectField>
      {error ? <ErrorText code={error} /> : null}
      <div className={styles.createActions}>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Back
        </Button>
        <Button type="submit" pending={pending} disabled={name.trim() === ''} data-ph-capture-attribute-label="exercise_search_create">
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
