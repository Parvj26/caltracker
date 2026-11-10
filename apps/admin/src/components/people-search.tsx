'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { buildSmartIndex, smartMatch } from '@caltracker/shared';
import styles from './admin.module.css';

export type Person = { user_id: string; kind: string; name: string; email: string; coach_name: string | null };

const MAX_RESULTS = 8;

/** "Search anyone by name or email…": the shared smart search (typos, partial words, any order) over admin_people(). */
export function PeopleSearch({ people }: { people: Person[] }) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const index = useMemo(
    () => buildSmartIndex(people, (p) => ({ name: p.name || p.email, extraWords: [p.email, p.email.split('@')[0] ?? ''] })),
    [people],
  );
  const hits = useMemo(
    () =>
      smartMatch(index, query)
        .sort((a, b) => a.tier - b.tier || a.item.name.localeCompare(b.item.name))
        .slice(0, MAX_RESULTS),
    [index, query],
  );
  const open = query.trim() !== '';
  return (
    <div className={styles.search}>
      <input
        type="search"
        aria-label="Search anyone"
        placeholder="Search anyone by name or email…"
        className={styles.searchInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-controls={open ? listId : undefined}
      />
      {open ? (
        <ul id={listId} className={styles.searchResults} aria-label="Search results">
          {hits.length === 0 ? <li className={styles.searchEmpty}>Nobody matches.</li> : null}
          {hits.map(({ item }) => {
            const href = item.kind === 'coach' ? `/coaches/${item.user_id}` : `/clients/${item.user_id}`;
            const what = item.kind === 'coach' ? 'Coach' : item.coach_name ? `Client of ${item.coach_name}` : 'Removed client';
            return (
              <li key={`${item.kind}-${item.user_id}`}>
                <Link href={href} className={styles.searchResult}>
                  {item.name || item.email}
                  <span className={styles.cellNote}>{what} · {item.email}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
