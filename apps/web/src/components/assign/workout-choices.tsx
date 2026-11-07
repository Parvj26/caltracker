'use client';

import { useId, useState } from 'react';
import { pickerSections, type WorkoutHints } from '@caltracker/shared';
import { EmptyLibrary } from '@/components/empty-library';
import { matchesSearch } from '@/app/(coach)/programs/[id]/search';
import calendar from '@/components/calendar/calendar.module.css';
import styles from './assign.module.css';

export type ChoiceWorkout = { id: string; name: string };

/**
 * A searchable list of library workouts where one tap picks a workout (the caller decides what picking does).
 * Before anything is typed it opens with the coach's shortcuts: "Recent" (their last-used workouts) and "Most used",
 * then "All workouts" (the rest), so each workout shows once. Typing searches the whole library in one list.
 * Every workout picker uses it: the calendar's "+ Add workout" and day "+", the program grid's "+", and Home's Assign.
 */
export function WorkoutChoices({
  library,
  hints,
  onPick,
  disabled = false,
  forProgram = false,
}: {
  library: readonly ChoiceWorkout[];
  hints?: WorkoutHints;
  onPick: (workout: ChoiceWorkout) => void;
  disabled?: boolean;
  /** On a program the empty library also explains that programs are built from it. */
  forProgram?: boolean;
}) {
  const resultsId = useId();
  const [query, setQuery] = useState('');
  if (library.length === 0) return <EmptyLibrary className={calendar.dialogBody} forProgram={forProgram} />;

  const searching = query.trim() !== '';
  const sections = !searching && hints ? pickerSections(library, hints) : null;
  const button = (w: ChoiceWorkout) => (
    <li key={w.id}>
      <button type="button" className={calendar.result} disabled={disabled} onClick={() => onPick(w)}>
        <span>{w.name}</span>
      </button>
    </li>
  );
  const section = (title: string, items: readonly ChoiceWorkout[]) =>
    items.length === 0 ? null : (
      <section key={title} aria-label={title}>
        <h3 className={styles.pickerHeading}>{title}</h3>
        <ul className={styles.pickerList}>{items.map(button)}</ul>
      </section>
    );

  return (
    <>
      <label className={calendar.searchLabel}>
        <span>Search workouts</span>
        <input
          type="search"
          className={calendar.input}
          value={query}
          aria-controls={resultsId}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {sections && (sections.recent.length > 0 || sections.mostUsed.length > 0) ? (
        <div id={resultsId} className={styles.pickerScroll}>
          {section('Recent', sections.recent)}
          {section('Most used', sections.mostUsed)}
          {section('All workouts', sections.rest)}
        </div>
      ) : (
        <ul id={resultsId} className={calendar.results} aria-label="Library workouts">
          {(() => {
            const results = library.filter((w) => matchesSearch(w.name, query));
            return results.length === 0 ? <li className={calendar.caption}>No workouts match.</li> : results.map(button);
          })()}
        </ul>
      )}
    </>
  );
}
