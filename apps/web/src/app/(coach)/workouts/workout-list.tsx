'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { smartFilter } from '@caltracker/shared';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { ListRow, RowList, SearchBox, SearchEmpty, useSearchQuery } from '@/components/ui';
import { LocalDate } from './local-date';
import { WorkoutRowMore } from './workout-row-actions';
import styles from './workouts.module.css';

export type WorkoutListRow = { id: string; name: string; updatedAt: string; exercises: number };

/**
 * The library list with its search box. Filters as you type with the shared smart search (typos, partial words, any
 * word order), like the Clients list. The query stays in the address (?q=) so Back from a workout keeps it.
 */
export function WorkoutList({ rows, initialQuery, limited, limit }: { rows: WorkoutListRow[]; initialQuery: string; limited: boolean; limit: number }) {
  const router = useRouter();
  const { query, setQuery, debounced, searching } = useSearchQuery({ initial: initialQuery, urlParam: 'q' });
  const shown = useMemo(() => {
    const smart = smartFilter(rows, debounced, (w) => w.name);
    if (!limited) return smart;
    // Past the cap the server adds older workouts whose names contain the text (a plain match): keep those too.
    const text = debounced.trim().toLowerCase();
    const seen = new Set(smart.map((w) => w.id));
    return [...smart, ...rows.filter((w) => !seen.has(w.id) && text !== '' && w.name.toLowerCase().includes(text))];
  }, [rows, debounced, limited]);

  // The list already shows the matches; Enter closes the phone keyboard. A library past the cap also asks the server,
  // which adds older workouts whose names contain the text.
  const onEnter = () => {
    if (limited) router.replace(query.trim() ? `/workouts?q=${encodeURIComponent(query.trim())}` : '/workouts');
  };

  return (
    <>
      <div role="search" aria-label="Find workouts" className={styles.search}>
        <SearchBox label="Search workouts" value={query} onChange={setQuery} onEnter={onEnter} name="q" />
      </div>

      {shown.length === 0 ? (
        searching ? (
          <SearchEmpty things="workouts" query={debounced} onClear={() => setQuery('')} className={styles.empty} />
        ) : (
          <p className={styles.empty}>No workouts yet. Build your first one.</p>
        )
      ) : (
        <>
          {/* Plain rows, edge to edge (rulebook §7): the whole row opens the workout; Assign (quiet) and ⋯ stay their own
              buttons. Wide screens show the exercises and date as columns with headers. */}
          <RowList aria-label="Workouts" className={styles.rows} columns={['Name', 'Exercises', 'Updated']}>
            {shown.map((w) => {
              const exercises = `${w.exercises} ${w.exercises === 1 ? 'exercise' : 'exercises'}`;
              return (
                <ListRow
                  key={w.id}
                  href={`/workouts/${w.id}`}
                  title={w.name}
                  meta={
                    <>
                      <span>{exercises}</span>
                      <span aria-hidden="true">·</span>
                      <LocalDate iso={w.updatedAt} short />
                    </>
                  }
                  cells={[exercises, <LocalDate key="d" iso={w.updatedAt} />]}
                  action={<AssignButton kind="workout" id={w.id} name={w.name} compact />}
                  more={<WorkoutRowMore id={w.id} name={w.name} />}
                />
              );
            })}
          </RowList>
          {limited ? <p className={styles.caption}>Showing the {limit} most recently updated. Search to find others.</p> : null}
        </>
      )}
    </>
  );
}
