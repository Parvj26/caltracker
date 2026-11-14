'use client';

import { useId, useState } from 'react';
import { pickerSections, smartFilter, type WorkoutHints } from '@caltracker/shared';
import { EmptyLibrary } from '@/components/empty-library';
import calendar from '@/components/calendar/calendar.module.css';
import { cx } from '@/components/ui/cx';
import styles from './assign.module.css';

export type ChoiceWorkout = { id: string; name: string };

/**
 * A searchable list of library workouts where one tap picks a workout (the caller decides what picking does).
 * Before anything is typed it opens with the coach's shortcuts: "Recent" (their last-used workouts) and "Most used",
 * then "All workouts" (the rest), so each workout shows once. Typing searches the whole library in one list, with the shared smart search (typos, partial words, best first).
 * Every workout picker uses it: the calendar's "+ Add workout" and day "+", the program grid's "+", and Home's Assign.
 */
export function WorkoutChoices({
  library,
  hints,
  onPick,
  disabled = false,
  forProgram = false,
  chosenIds,
  listClassName,
}: {
  library: readonly ChoiceWorkout[];
  hints?: WorkoutHints;
  onPick: (workout: ChoiceWorkout) => void;
  disabled?: boolean;
  /** On a program the empty library also explains that programs are built from it. */
  forProgram?: boolean;
  /** Workouts already picked (the invite window's single workouts): marked "✓ chosen" and pressed. */
  chosenIds?: ReadonlySet<string>;
  /** Extra class on the scrolling list (a full-screen sheet lets it take the spare height). */
  listClassName?: string | undefined;
}) {
  const resultsId = useId();
  const [query, setQuery] = useState('');
  if (library.length === 0) return <EmptyLibrary className={calendar.dialogBody} forProgram={forProgram} />;

  const searching = query.trim() !== '';
  const sections = !searching && hints ? pickerSections(library, hints) : null;
  const button = (w: ChoiceWorkout) => {
    const chosen = chosenIds?.has(w.id) ?? false;
    return (
      <li key={w.id}>
        <button
          type="button"
          className={calendar.result}
          disabled={disabled}
          aria-pressed={chosenIds ? chosen : undefined}
          onClick={() => onPick(w)}
        >
          <span>{w.name}</span>
          {chosen ? <span aria-hidden="true" className={styles.chosenTag}>✓ chosen</span> : null}
        </button>
      </li>
    );
  };
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
        <div id={resultsId} className={cx(styles.pickerScroll, listClassName)}>
          {section('Recent', sections.recent)}
          {section('Most used', sections.mostUsed)}
          {section('All workouts', sections.rest)}
        </div>
      ) : (
        <ul id={resultsId} className={cx(calendar.results, listClassName)} aria-label="Library workouts">
          {(() => {
            const results = smartFilter(library, query, (w) => w.name);
            return results.length === 0 ? <li className={calendar.caption}>No workouts match.</li> : results.map(button);
          })()}
        </ul>
      )}
    </>
  );
}
