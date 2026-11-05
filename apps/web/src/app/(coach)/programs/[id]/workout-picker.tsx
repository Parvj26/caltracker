'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { EmptyLibrary } from '@/components/empty-library';
import { Button } from '@/components/ui';
import type { LibraryWorkout } from './program-grid';
import { matchesSearch } from './search';
import styles from '../programs.module.css';

type Props = {
  /** e.g. "Week 1, Day 4". */
  cellLabel: string;
  library: LibraryWorkout[];
  onPick: (workout: LibraryWorkout) => void;
  onClose: () => void;
  /** On a program the empty library also explains that programs are built from it. */
  forProgram?: boolean;
};

/**
 * Pick a library workout for one day, in a native modal dialog (focus is trapped and Escape closes it). This is the
 * keyboard and touch path; dragging from the library panel does the same with a mouse.
 */
export function WorkoutPicker({ cellLabel, library, onPick, onClose, forProgram = false }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    // The picker unmounts when it closes, so hand focus back to the "+" button that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const results = library.filter((w) => matchesSearch(w.name, query));

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className={styles.dialogTitle}>Add a workout to {cellLabel}</h2>
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
      <ul id={resultsId} className={styles.results}>
        {library.length === 0 ? (
          <li className={styles.emptyLibrary}>
            <EmptyLibrary className={styles.caption} forProgram={forProgram} />
          </li>
        ) : results.length === 0 ? (
          <li className={styles.caption}>No workouts match.</li>
        ) : null}
        {results.map((w) => (
          <li key={w.id}>
            <button type="button" className={styles.result} onClick={() => onPick(w)}>
              {w.name}
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.dialogActions}>
        <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
