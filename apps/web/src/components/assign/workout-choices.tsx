'use client';

import { useId, useState } from 'react';
import { EmptyLibrary } from '@/components/empty-library';
import { matchesSearch } from '@/app/(coach)/programs/[id]/search';
import calendar from '@/components/calendar/calendar.module.css';

export type ChoiceWorkout = { id: string; name: string };

/**
 * A searchable list of library workouts where one tap picks a workout (the caller decides what picking does).
 * Used wherever a coach puts a single workout on a client's day.
 */
export function WorkoutChoices({
  library,
  onPick,
  disabled = false,
}: {
  library: readonly ChoiceWorkout[];
  onPick: (workout: ChoiceWorkout) => void;
  disabled?: boolean;
}) {
  const resultsId = useId();
  const [query, setQuery] = useState('');
  if (library.length === 0) return <EmptyLibrary className={calendar.dialogBody} />;
  const results = library.filter((w) => matchesSearch(w.name, query));
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
      <ul id={resultsId} className={calendar.results} aria-label="Library workouts">
        {results.length === 0 ? <li className={calendar.caption}>No workouts match.</li> : null}
        {results.map((w) => (
          <li key={w.id}>
            <button type="button" className={calendar.result} disabled={disabled} onClick={() => onPick(w)}>
              <span>{w.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
