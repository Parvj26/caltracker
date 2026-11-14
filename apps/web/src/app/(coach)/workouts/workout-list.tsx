'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { smartFilter } from '@caltracker/shared';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { DuplicateButton } from '@/components/duplicate-button';
import { Button, Card, TextField } from '@/components/ui';
import { LocalDate } from './local-date';
import styles from './workouts.module.css';
import assignStyles from '@/components/assign/assign.module.css';

export type WorkoutListRow = { id: string; name: string; updatedAt: string; exercises: number };

/**
 * The library list with its search box. Filters as you type with the shared smart search (typos, partial words, any
 * word order), like the Clients list. The query stays in the address (?q=) so Back from a workout keeps it.
 */
export function WorkoutList({ rows, initialQuery, limited, limit }: { rows: WorkoutListRow[]; initialQuery: string; limited: boolean; limit: number }) {
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(() => smartFilter(rows, query, (w) => w.name), [rows, query]);
  const searching = query.trim() !== '';

  const onChange = (value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  // The list already shows the matches; Search (or Enter) just closes the phone keyboard.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  return (
    <>
      <Card className={styles.searchCard}>
        <form method="get" action="/workouts" className={styles.searchRow} role="search" onSubmit={onSubmit}>
          <TextField
            label="Search"
            type="search"
            name="q"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className={styles.searchField}
          />
          <Button type="submit">Search</Button>
        </form>
      </Card>

      {shown.length === 0 ? (
        <p className={styles.empty}>{searching ? 'No workouts match.' : 'No workouts yet. Build your first one.'}</p>
      ) : (
        <Card className={styles.listCard}>
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
                    <div className={`${assignStyles.actions} ${styles.rowActions}`}>
                      <AssignButton kind="workout" id={w.id} name={w.name} compact />
                      <DuplicateButton kind="workout" id={w.id} name={w.name} compact />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {limited ? (
            <p className={styles.caption}>
              Showing the {limit} most recently updated{searching ? ', and searching those' : ''}.
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
