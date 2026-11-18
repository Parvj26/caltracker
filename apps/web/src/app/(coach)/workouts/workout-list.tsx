'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { smartFilter } from '@caltracker/shared';
import { Card, SearchBox, SearchEmpty, useSearchQuery } from '@/components/ui';
import { LocalDate } from './local-date';
import { WorkoutRowActions } from './workout-row-actions';
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
        <Card>
          <table className={styles.table} aria-label="Workouts">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Exercises</th>
                <th scope="col">Updated</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link href={`/workouts/${w.id}`} className={styles.nameLink}>
                      {w.name}
                    </Link>
                  </td>
                  <td className={styles.numeric}>
                    {w.exercises}
                    <span className={styles.phoneOnly}>{w.exercises === 1 ? ' exercise' : ' exercises'}</span>
                  </td>
                  <td className={styles.numeric}>
                    <span className={styles.phoneOnly}>Updated </span>
                    <LocalDate iso={w.updatedAt} />
                  </td>
                  <td>
                    <WorkoutRowActions id={w.id} name={w.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {limited ? (
            <p className={styles.caption}>Showing the {limit} most recently updated. Search to find others.</p>
          ) : null}
        </Card>
      )}
    </>
  );
}
