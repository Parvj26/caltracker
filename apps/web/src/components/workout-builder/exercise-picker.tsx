'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ExercisePick } from '@caltracker/shared';
import { TRACKING_LABELS } from '@/app/(coach)/exercises/filters';
import { searchExercises } from '@/app/(coach)/workouts/actions';
import { Button, ErrorText } from '@/components/ui';
import styles from './builder.module.css';

type Props = {
  title: string;
  /** Pick several (a superset needs at least two) and confirm, instead of picking one. */
  multiple: boolean;
  onPick: (exercises: ExercisePick[]) => void;
  onClose: () => void;
};

/** Search built-in and custom exercises in a native modal dialog (focus is trapped and Escape closes it). */
export function ExercisePicker({ title, multiple, onPick, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const resultsId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExercisePick[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<ExercisePick[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    // The picker unmounts when it closes, so hand focus back to the button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      searchExercises(query)
        .then((rows) => {
          if (stale) return;
          setResults(rows);
          setError(false);
        })
        .catch(() => {
          if (!stale) setError(true);
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query]);

  const isSelected = (ex: ExercisePick) => selected.some((s) => s.id === ex.id);
  function choose(ex: ExercisePick) {
    if (!multiple) {
      onPick([ex]);
      return;
    }
    setSelected((cur) => (cur.some((s) => s.id === ex.id) ? cur.filter((s) => s.id !== ex.id) : [...cur, ex]));
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
      <label className={styles.searchLabel}>
        <span>Search exercises</span>
        <input
          type="search"
          className={styles.input}
          value={query}
          aria-controls={resultsId}
          aria-describedby={multiple ? hintId : undefined}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {multiple ? (
        <p id={hintId} className={styles.caption}>
          A superset needs 2 or more exercises. Search and tap each one.
        </p>
      ) : null}

      {multiple ? (
        // Always mounted, so screen readers hear each pick as it is added.
        <div className={styles.selected} aria-live="polite">
          {selected.length > 0 ? (
            <ol className={styles.selectedList} aria-label="Picked, in the order they're done">
              {selected.map((ex) => (
                <li key={ex.id}>
                  {ex.name}
                  <button
                    type="button"
                    className={styles.smallButton}
                    aria-label={`Remove ${ex.name}`}
                    onClick={() => choose(ex)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorText>Couldn&apos;t load exercises. Please try again.</ErrorText> : null}
      <ul id={resultsId} className={styles.results} aria-busy={results === null}>
        {results?.length === 0 ? <li className={styles.caption}>No exercises match.</li> : null}
        {results?.map((ex) => {
          const descId = `${resultsId}-${ex.id}`;
          return (
            <li key={ex.id}>
              <button
                type="button"
                className={styles.result}
                aria-label={ex.name}
                aria-describedby={descId}
                aria-pressed={multiple ? isSelected(ex) : undefined}
                onClick={() => choose(ex)}
              >
                <span>{ex.name}</span>
                <span id={descId} className={styles.caption}>{TRACKING_LABELS[ex.trackingType]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        {multiple ? (
          <Button disabled={selected.length < 2} onClick={() => onPick(selected)}>
            {selected.length < 2 ? 'Pick at least 2 exercises' : `Add ${selected.length} exercises`}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
