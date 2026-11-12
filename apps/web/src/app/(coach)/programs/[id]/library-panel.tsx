'use client';

import { useDraggable } from '@dnd-kit/core';
import { useId, useRef, useState } from 'react';
import { EmptyLibrary } from '@/components/empty-library';
import { cx } from '@/components/ui/cx';
import { libraryItemDomId } from './grid-ids';
import type { DragData, LibraryWorkout } from './program-grid';
import { matchesSearch } from './search';
import styles from '../programs.module.css';

/**
 * The coach's library workouts: tap one (or Enter) to pick a day for it, or drag it onto a day (a mouse drag, a long
 * press on a touch screen, or Space and the arrow keys).
 */
export function LibraryPanel({
  library,
  onPick,
  justDragged,
}: {
  library: LibraryWorkout[];
  onPick: (workout: LibraryWorkout) => void;
  /** True right after a drag ended, so the click that ends a drag doesn't also open "Add to which day?". */
  justDragged: () => boolean;
}) {
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
          <p className={styles.caption}>Tap a workout to add it to a day, or drag it onto one (on a touch screen, press and hold first).</p>
          <label className={styles.searchLabel}>
            <span>Search library</span>
            <input type="search" className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ul className={styles.libraryList}>
            {results.length === 0 ? <li className={styles.caption}>No workouts match.</li> : null}
            {results.map((w) => (
              <LibraryItem key={w.id} workout={w} onPick={() => onPick(w)} justDragged={justDragged} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function LibraryItem({ workout, onPick, justDragged }: { workout: LibraryWorkout; onPick: () => void; justDragged: () => boolean }) {
  const data: DragData = { kind: 'library', workout };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `library-${workout.id}`, data });
  // Where the pointer went down, so a click that ends a short drag doesn't also open the day picker.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  return (
    <li>
      <button
        type="button"
        id={libraryItemDomId(workout.id)}
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        // A tap (a click without a drag) asks which day. Enter does the same from the keyboard; Space still picks the
        // workout up to drag it. A keyboard click (detail 0, from Space) belongs to the drag.
        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={(e) => {
          const from = downAt.current;
          const moved = from ? Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4 : false;
          if (e.detail > 0 && !moved && !justDragged()) onPick();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onPick();
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
        data-ph-capture-attribute-label="program_library_workout"
        className={cx(styles.libraryItem, isDragging && styles.dragging)}
      >
        {workout.name}
      </button>
    </li>
  );
}
