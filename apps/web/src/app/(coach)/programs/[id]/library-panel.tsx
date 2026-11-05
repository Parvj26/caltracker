'use client';

import { useDraggable } from '@dnd-kit/core';
import { useId, useState } from 'react';
import { EmptyLibrary } from '@/components/empty-library';
import { cx } from '@/components/ui/cx';
import type { DragData, LibraryWorkout } from './program-grid';
import { matchesSearch } from './search';
import styles from '../programs.module.css';

/** The coach's library workouts, to drag onto days. */
export function LibraryPanel({ library }: { library: LibraryWorkout[] }) {
  const [query, setQuery] = useState('');
  const headingId = useId();
  const results = library.filter((w) => matchesSearch(w.name, query));
  return (
    <section className={styles.library} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionHeading}>Library</h2>
      {library.length === 0 ? (
        <EmptyLibrary className={styles.caption} forProgram />
      ) : (
        <>
          <p className={styles.caption}>Drag a workout onto a day, or use a day&apos;s + button.</p>
          <label className={styles.searchLabel}>
            <span>Search library</span>
            <input type="search" className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ul className={styles.libraryList}>
            {results.length === 0 ? <li className={styles.caption}>No workouts match.</li> : null}
            {results.map((w) => (
              <LibraryItem key={w.id} workout={w} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LibraryItem({ workout }: { workout: LibraryWorkout }) {
  const data: DragData = { kind: 'library', workout };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `library-${workout.id}`, data });
  return (
    <li>
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={cx(styles.libraryItem, isDragging && styles.dragging)}
      >
        {workout.name}
      </button>
    </li>
  );
}
