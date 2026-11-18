'use client';

import type { ErrorCode } from '@caltracker/shared';
import { smartFilter } from '@caltracker/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { AssignButton } from '@/components/assign/assign-to-clients';
import { MoreMenu } from '@/components/more-menu';
import { ErrorText, ListRow, RowList, SearchBox, SearchCount, SearchEmpty, useSearchQuery } from '@/components/ui';
import { failureCode } from '@/lib/action-errors';
import { DeleteProgram, type DeleteProgramHandle } from './[id]/delete-program';
import { duplicateProgram } from './actions';
import styles from './programs.module.css';

export type ProgramListRow = { id: string; name: string; weeks: number; slots: number };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The row's ⋯ (Assign sits beside it): Duplicate (makes "<name> (copy)" and opens it) and Delete… (asks first). */
function ProgramMore({ id, name }: { id: string; name: string }) {
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
    <span className={styles.rowMore}>
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
    </span>
  );
}

/**
 * The Programs list with its search box. Filters as you type with the shared smart search (typos, partial words, any
 * word order), like the Workouts list. The query stays in the address (?q=) so Back from a program keeps it; past the
 * list cap a submitted search also asks the server, which adds older programs whose names contain the text.
 * Plain rows on every size; wide screens add column headers.
 */
export function ProgramList({ rows, total, initialQuery, limited, limit }: { rows: ProgramListRow[]; total: number; initialQuery: string; limited: boolean; limit: number }) {
  const router = useRouter();
  const { query, setQuery, debounced, searching } = useSearchQuery({ initial: initialQuery, urlParam: 'q' });
  const shown = useMemo(() => {
    const smart = smartFilter(rows, debounced, (p) => p.name);
    if (!limited) return smart;
    // Past the cap the server adds older programs whose names contain the text (a plain match): keep those too.
    const text = debounced.trim().toLowerCase();
    const seen = new Set(smart.map((p) => p.id));
    return [...smart, ...rows.filter((p) => !seen.has(p.id) && text !== '' && p.name.toLowerCase().includes(text))];
  }, [rows, debounced, limited]);

  // The list already shows the matches; Enter closes the phone keyboard and, past the cap, asks the server.
  const onEnter = () => {
    if (limited) router.replace(query.trim() ? `/programs?q=${encodeURIComponent(query.trim())}` : '/programs');
  };

  return (
    <>
      <div role="search" aria-label="Find programs" className={styles.searchForm}>
        <SearchBox
          label="Search programs"
          placeholder={`Search ${total} ${plural(total, 'program', 'programs')}`}
          value={query}
          onChange={setQuery}
          onEnter={onEnter}
          name="q"
        />
      </div>
      <SearchCount className={searching ? styles.caption : styles.visuallyHidden}>
        {searching ? `${shown.length} of ${total} ${plural(total, 'program', 'programs')}` : ''}
      </SearchCount>

      {shown.length === 0 ? (
        searching ? (
          <SearchEmpty things="programs" query={debounced} onClear={() => setQuery('')} className={styles.empty} />
        ) : (
          <p className={styles.empty}>No programs yet. Build your first one.</p>
        )
      ) : (
        <>
          {/* Plain rows, edge to edge (rulebook §7): the whole row opens the program; Assign (quiet) and ⋯ stay their own
              buttons. Wide screens show weeks and workouts as columns with headers. */}
          <RowList aria-label="Programs" className={styles.rows} columns={['Name', 'Weeks', 'Workouts']}>
            {shown.map((p) => {
              const weeks = `${p.weeks} ${plural(p.weeks, 'week', 'weeks')}`;
              const workouts = `${p.slots} ${plural(p.slots, 'workout', 'workouts')}`;
              return (
                <ListRow
                  key={p.id}
                  href={`/programs/${p.id}`}
                  title={p.name}
                  meta={
                    <>
                      <span>{weeks}</span>
                      <span aria-hidden="true">·</span>
                      <span>{workouts}</span>
                    </>
                  }
                  cells={[weeks, workouts]}
                  action={<AssignButton kind="program" id={p.id} name={p.name} compact />}
                  more={<ProgramMore id={p.id} name={p.name} />}
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
