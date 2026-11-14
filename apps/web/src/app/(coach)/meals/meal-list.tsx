'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { compactMacroLine, smartFilter } from '@caltracker/shared';
import { cx } from '@/components/ui/cx';
import type { ListedCoachMeal } from '@/lib/coach-meals';
import { loggedLabel, mealInitial } from './meal-labels';
import styles from './meals.module.css';

const TILES = ['var(--ct-drop)', 'var(--ct-lime)', 'var(--ct-blue)', 'var(--ct-celebrate-bg)'];
/** The colour tile for a meal without a photo, fixed by its id. */
export function tileColour(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILES[h % TILES.length] ?? 'var(--ct-surface)';
}

/** The photo, or the meal's first letter on its colour tile. */
export function MealTile({ id, name, src, className }: { id: string; name: string; src: string | null; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image can't cache it
    <img src={src} alt={`${name} photo`} className={cx(styles.thumb, className)} />
  ) : (
    <span className={cx(styles.thumb, styles.thumbInitial, className)} style={{ background: tileColour(id) }} aria-hidden="true">
      {mealInitial(name)}
    </span>
  );
}

/**
 * The shared meals with a search box. Filters as you type with the shared smart search (typos, partial words, any word
 * order), like the Workouts list. The text stays in the address (?q=) and in the meal links, so Back keeps it.
 */
export function MealList({ meals, selectedId, initialQuery }: { meals: ListedCoachMeal[]; selectedId: string | null; initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(() => smartFilter(meals, query, (m) => m.name), [meals, query]);
  const q = query.trim();

  function onChange(value: string) {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  if (meals.length === 0) {
    return (
      <p className={styles.empty} data-testid="coach-meals-empty">
        No meals yet. Add one your clients can log in one tap.
      </p>
    );
  }

  return (
    <div className={styles.listColumn}>
      <label className={styles.search}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          className={styles.searchInput}
          aria-label="Search meals"
          placeholder="Search meals"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // The list already shows the matches; Enter only closes the phone keyboard.
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
      </label>
      {shown.length === 0 ? (
        <p className={styles.empty}>No meals match &quot;{q}&quot;.</p>
      ) : (
        <ul className={styles.list} aria-label="Shared meals">
          {shown.map((m) => (
            <li key={m.id}>
              <Link
                href={q ? `/meals/${m.id}?q=${encodeURIComponent(q)}` : `/meals/${m.id}`}
                className={cx(styles.row, m.id === selectedId && styles.rowSelected)}
                aria-current={m.id === selectedId ? 'page' : undefined}
                data-testid="coach-meal-row"
              >
                <MealTile id={m.id} name={m.name} src={m.thumbUrl} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{m.name}</span>
                  <span className={styles.rowMacros}>{compactMacroLine(m.macros)}</span>
                  <span className={styles.rowLogged}>{loggedLabel(m.logged)}</span>
                </span>
                <svg className={styles.chevron} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
