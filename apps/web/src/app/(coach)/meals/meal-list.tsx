'use client';

import { useMemo } from 'react';
import { compactMacroLine, smartFilter } from '@caltracker/shared';
import { ListRow, RowList, SearchBox, SearchEmpty, useSearchQuery } from '@/components/ui';
import { ChevronIcon } from '@/components/ui/chevron-icon';
import { cx } from '@/components/ui/cx';
import type { ListedCoachMeal } from '@/lib/coach-meals';
import { loggedNote, mealHref, mealInitial } from './meal-labels';
import styles from './meals.module.css';

/** The photo, or the meal's first letter on a calm grey tile (the old random colours meant nothing). */
export function MealTile({ name, src, className }: { id?: string; name: string; src: string | null; className?: string | undefined }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image can't cache it
    <img src={src} alt={`${name} photo`} className={cx(styles.thumb, className)} />
  ) : (
    <span className={cx(styles.thumb, styles.thumbInitial, className)} aria-hidden="true">
      {mealInitial(name)}
    </span>
  );
}

/**
 * The shared meals with a search box. Filters as you type with the shared smart search (typos, partial words, any word
 * order), like the Workouts list. The text stays in the address (?q=) and in the meal links, so Back keeps it.
 */
export function MealList({ meals, selectedId, initialQuery }: { meals: ListedCoachMeal[]; selectedId: string | null; initialQuery: string }) {
  const { query, setQuery, debounced } = useSearchQuery({ initial: initialQuery, urlParam: 'q' });
  const shown = useMemo(() => smartFilter(meals, debounced, (m) => m.name), [meals, debounced]);
  const q = debounced.trim();

  if (meals.length === 0) {
    return (
      <p className={styles.empty} data-testid="coach-meals-empty">
        No meals yet. Add one your clients can log in one tap.
      </p>
    );
  }

  return (
    <div className={styles.listColumn}>
      <SearchBox label="Search meals" value={query} onChange={setQuery} />
      {shown.length === 0 ? (
        <SearchEmpty things="meals" query={q} onClear={() => setQuery('')} className={styles.empty} />
      ) : (
        <RowList aria-label="Shared meals">
          {shown.map((m) => {
            const macros = compactMacroLine(m.macros);
            const logged = loggedNote(m.logged);
            return (
              <ListRow
                key={m.id}
                href={mealHref(m.id, q)}
                current={m.id === selectedId}
                leading={<MealTile id={m.id} name={m.name} src={m.thumbUrl} />}
                title={m.name}
                meta={macros || logged ? [macros, logged].filter(Boolean).join(' · ') : null}
                end={<ChevronIcon direction="right" size={20} />}
                linkProps={{ 'data-testid': 'coach-meal-row' }}
              />
            );
          })}
        </RowList>
      )}
    </div>
  );
}
