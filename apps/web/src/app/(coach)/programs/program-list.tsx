'use client';

import type { ErrorCode } from '@caltracker/shared';
import { smartFilter } from '@caltracker/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { LinkRow } from '@/components/link-row';
import { MoreMenu } from '@/components/more-menu';
import { Card, ErrorText } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { DeleteProgram, type DeleteProgramHandle } from './[id]/delete-program';
import { duplicateProgram } from './actions';
import styles from './programs.module.css';
import assignStyles from '@/components/assign/assign.module.css';

export type ProgramListRow = { id: string; name: string; weeks: number; slots: number };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Assign, then ⋯ with Duplicate (makes "<name> (copy)" and opens it) and Delete… (asks first). */
function ProgramActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, startTransition] = useTransition();
  const deleteRef = useRef<DeleteProgramHandle>(null);

  function duplicate() {
    setError(null);
    startTransition(async () => {
      try {
        const outcome = await duplicateProgram(id);
        if (!outcome.ok) {
          setError(outcome.code);
          return;
        }
        router.push(`/programs/${outcome.id}?copied=1`);
      } catch (e) {
        setError(failureCode(e, 'copy_offline'));
      }
    });
  }

  return (
    <div className={`${assignStyles.actions} ${styles.rowActions}`} data-row-actions>
      <AssignButton kind="program" id={id} name={name} compact />
      <MoreMenu
        label={`More for ${name}`}
        busy={pending}
        items={[
          { label: pending ? 'Duplicating…' : 'Duplicate', onSelect: duplicate, disabled: pending },
          { label: 'Delete…', onSelect: () => deleteRef.current?.open(), danger: true },
        ]}
      />
      {pending ? <span className={styles.visuallyHidden} role="status">Duplicating…</span> : null}
      {error ? <ErrorText code={error} /> : null}
      <DeleteProgram id={id} name={name} handle={deleteRef} />
    </div>
  );
}

/**
 * The Programs list with its search box. Filters as you type with the shared smart search (typos, partial words, any
 * word order), like the Workouts list. The query stays in the address (?q=) so Back from a program keeps it; past the
 * list cap a submitted search also asks the server, which adds older programs whose names contain the text.
 * Laptops and iPads see a table; phones see one card per program.
 */
export function ProgramList({ rows, total, initialQuery, limited, limit }: { rows: ProgramListRow[]; total: number; initialQuery: string; limited: boolean; limit: number }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(() => {
    const smart = smartFilter(rows, query, (p) => p.name);
    if (!limited) return smart;
    // Past the cap the server adds older programs whose names contain the text (a plain match): keep those too.
    const text = query.trim().toLowerCase();
    const seen = new Set(smart.map((p) => p.id));
    return [...smart, ...rows.filter((p) => !seen.has(p.id) && text !== '' && p.name.toLowerCase().includes(text))];
  }, [rows, query, limited]);
  const searching = query.trim() !== '';

  const onChange = (value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  // The list already shows the matches; Search (Enter) closes the phone keyboard and, past the cap, asks the server.
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (limited) router.replace(query.trim() ? `/programs?q=${encodeURIComponent(query.trim())}` : '/programs');
  };

  return (
    <>
      <form method="get" action="/programs" role="search" aria-label="Find programs" className={styles.searchForm} onSubmit={onSubmit}>
        <label className={styles.searchField}>
          <span className={styles.visuallyHidden}>Search programs</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            name="q"
            value={query}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Search ${total} ${plural(total, 'program', 'programs')}`}
            className={styles.searchInput}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        {searching ? (
          <button type="button" className={styles.clearSearch} aria-label="Clear search" onClick={() => onChange('')}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </form>
      <p role="status" className={searching ? styles.caption : styles.visuallyHidden}>
        {searching ? `${shown.length} of ${total} ${plural(total, 'program', 'programs')}` : ''}
      </p>

      {shown.length === 0 ? (
        <p className={styles.empty}>{searching ? 'No programs match.' : 'No programs yet. Build your first one.'}</p>
      ) : (
        <Card className={styles.listCard}>
          <table role="table" className={styles.table} aria-label="Programs">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Name</th>
                <th role="columnheader" scope="col">Weeks</th>
                <th role="columnheader" scope="col">Workouts</th>
                <th role="columnheader" scope="col">
                  <span className={styles.visuallyHidden}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {shown.map((p) => (
                // The whole row (a card on a phone) opens the program; Assign and ⋯ stay their own buttons.
                <LinkRow key={p.id} href={`/programs/${p.id}`} role="row">
                  <td role="cell" className={styles.nameCell}>
                    <Link href={`/programs/${p.id}`} className={styles.nameLink}>
                      <span className={styles.nameText}>{p.name}</span>
                    </Link>
                  </td>
                  <td role="cell" className={`${styles.numeric} ${styles.weeksCell}`}>
                    {p.weeks}
                    <span className={styles.phoneOnly}>{plural(p.weeks, ' week', ' weeks')}</span>
                  </td>
                  <td role="cell" className={`${styles.numeric} ${styles.slotsCell}`}>
                    <span className={styles.phoneOnly} aria-hidden="true">·&nbsp;</span>
                    {p.slots}
                    <span className={styles.phoneOnly}>{plural(p.slots, ' workout', ' workouts')}</span>
                  </td>
                  <td role="cell" className={styles.actionsCell}>
                    <ProgramActions id={p.id} name={p.name} />
                  </td>
                </LinkRow>
              ))}
            </tbody>
          </table>
          {limited ? <p className={styles.caption}>Showing the {limit} most recently updated. Search to find others.</p> : null}
        </Card>
      )}
    </>
  );
}
