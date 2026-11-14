'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  EQUIPMENT_CHIPS,
  LIBRARY_TRACKING_TYPES,
  MUSCLE_CHIPS,
  buildExerciseIndex,
  searchExercises,
  type SearchFilters,
} from '@caltracker/shared';
import { FavouriteButton } from '@/components/exercise-search/favourite-button';
import { Photo } from '@/components/exercise-search/photo';
import { Button, Chip, ErrorText } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { exerciseImageUrl, loadExerciseIndex, type LoadedExerciseIndex } from '@/lib/exercise-index';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { TRACKING_LABELS } from './filters';
import { matchesListFilter, sheetFilterCount } from './list-filter';
import { clearListReturn, readListReturn, saveListReturn } from './list-return';
import { useFavourites } from './use-favourites';
import styles from './exercises.module.css';

const PAGE_SIZE = 50;
/** "body only" -> "Body only" (the library stores them in lower case). */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

type Props = {
  workspaceId: string;
  initialQuery: string;
  initialSource: '' | 'builtin' | 'custom';
  tracking: string;
  onTrackingChange: (next: string) => void;
};

/**
 * The Exercises page on a phone (approved mockup, row 5): search on top, one sideways row of chips (Filters,
 * Favourites, the muscles), and a plain list that scrolls with the page. Tracking type, equipment and Custom only sit
 * in the Filters sheet. A tap on an exercise opens its own page. Same shared smart search as the laptop list.
 */
export function PhoneExerciseList({ workspaceId, initialQuery, initialSource, tracking, onTrackingChange }: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const [data, setData] = useState<LoadedExerciseIndex | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({ ...NO_FILTERS, customOnly: initialSource === 'custom' });
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const { favourites, toggle: toggleStar, error: starError, reset: resetFavourites } = useFavourites([]);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const sheetTitleId = useId();
  const restoreY = useRef<number | null>(null);

  useEffect(() => {
    let stale = false;
    loadExerciseIndex(supabase, workspaceId)
      .then((d) => {
        if (stale) return;
        // Back from an exercise: show as many rows as before, then scroll to where the coach was (below).
        const place = readListReturn();
        if (place && place.url === `${window.location.pathname}${window.location.search}`) {
          setShown(Math.max(PAGE_SIZE, Math.min(place.shown, 2000)));
          restoreY.current = place.y;
        }
        clearListReturn();
        setData(d);
        resetFavourites(d.favourites);
      })
      .catch(() => {
        if (!stale) setLoadFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [supabase, workspaceId, resetFavourites]);

  useEffect(() => {
    if (!data || restoreY.current === null) return;
    const y = restoreY.current;
    restoreY.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [data]);

  const index = useMemo(() => (data ? buildExerciseIndex(data.index) : null), [data]);
  // Ranking uses the favourites as loaded, so starring a row doesn't make it jump while the coach looks at it.
  const boosts = useMemo(() => ({ favourites: new Set(data?.favourites ?? []), recent: data?.recent ?? [] }), [data]);
  const hits = useMemo(() => {
    if (!index) return [];
    const list = { tracking, builtinOnly: initialSource === 'builtin', favouritesOnly };
    return searchExercises(index, query, filters, boosts).filter((h) => matchesListFilter(h.row, list, favourites));
  }, [index, query, filters, boosts, tracking, initialSource, favouritesOnly, favourites]);

  function changeQuery(value: string) {
    setQuery(value);
    setShown(PAGE_SIZE);
    // Kept in the address, so Back from an exercise comes back to the same search.
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set('q', value);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }
  function changeFilters(next: SearchFilters) {
    setFilters(next);
    setShown(PAGE_SIZE);
  }
  function clearAll() {
    changeFilters({ ...NO_FILTERS, muscles: filters.muscles });
    onTrackingChange('');
  }

  const inSheet = sheetFilterCount(filters, tracking);
  const total = data?.index.length;
  const imageUrl = (path: string) => exerciseImageUrl(supabase, path);

  return (
    <div className={styles.phoneList}>
      <div className={styles.phoneBar}>
        <label className={styles.search}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            className={styles.searchInput}
            aria-label="Search exercises"
            placeholder={total ? `Search ${total} exercises` : 'Search exercises'}
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        <div className={styles.pillRow} role="group" aria-label="Quick filters">
          <button
            type="button"
            className={cx(styles.pill, styles.pillFilters)}
            aria-haspopup="dialog"
            onClick={() => sheetRef.current?.showModal()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filters
            {inSheet > 0 ? <span className={styles.pillCount}>{inSheet}</span> : null}
          </button>
          <button type="button" className={styles.pill} aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly((on) => !on)}>
            <span aria-hidden="true">{favouritesOnly ? '★' : '☆'}</span>
            Favourites
          </button>
          {MUSCLE_CHIPS.map((m) => (
            <button
              key={m}
              type="button"
              className={styles.pill}
              aria-pressed={filters.muscles.includes(m)}
              onClick={() => changeFilters({ ...filters, muscles: toggle(filters.muscles, m) })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {loadFailed ? <ErrorText code="exercises_load_failed" /> : null}
      {starError ? <ErrorText code={starError} /> : null}

      {data && hits.length === 0 ? (
        <div className={styles.phoneEmpty}>
          <p>{query.trim() ? `No exercises match "${query.trim()}"` : 'No exercises match these filters'}</p>
          {inSheet > 0 || filters.muscles.length > 0 || favouritesOnly ? (
            <Button
              variant="secondary"
              onClick={() => {
                changeFilters(NO_FILTERS);
                setFavouritesOnly(false);
                onTrackingChange('');
              }}
            >
              Clear filters
            </Button>
          ) : null}
          <Link href="/exercises/new" className={styles.textLink}>
            Create a custom exercise
          </Link>
        </div>
      ) : (
        <ul className={styles.phoneRows} aria-label="Exercises" aria-busy={!data && !loadFailed}>
          {hits.slice(0, shown).map(({ row }) => (
            <li key={row.id} className={styles.phoneRow}>
              <Link
                href={`/exercises/${row.id}`}
                className={styles.phoneRowLink}
                onClick={() => saveListReturn({ url: `${window.location.pathname}${window.location.search}`, y: window.scrollY, shown })}
              >
                <Photo src={row.imagePath ? imageUrl(row.imagePath) : null} alt="" width={54} height={54} className={styles.phoneThumb ?? ''} />
                <span className={styles.phoneRowText}>
                  <span className={styles.phoneRowName}>{row.name}</span>
                  <span className={styles.phoneTags} aria-hidden="true">
                    {row.primaryMuscles[0] ? <Chip tone="blue">{capital(row.primaryMuscles[0])}</Chip> : null}
                    {row.equipment ? <Chip tone="grey">{capital(row.equipment)}</Chip> : null}
                    {row.source === 'custom' ? <Chip tone="lime">Custom</Chip> : null}
                  </span>
                </span>
              </Link>
              <FavouriteButton name={row.name} favourite={favourites.has(row.id)} onToggle={() => void toggleStar(row.id, !favourites.has(row.id))} />
            </li>
          ))}
        </ul>
      )}
      {hits.length > shown ? (
        <Button variant="secondary" className={styles.showMore} onClick={() => setShown((n) => n + PAGE_SIZE)}>
          Show more ({hits.length - shown} left)
        </Button>
      ) : null}

      <dialog
        ref={sheetRef}
        className={styles.sheet}
        aria-labelledby={sheetTitleId}
        onClick={(e) => {
          // A tap on the dimmed area above the sheet closes it.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <span className={styles.grab} aria-hidden="true" />
        <h2 id={sheetTitleId} className={styles.sheetTitle}>
          Filters
        </h2>
        <div className={styles.sheetGroup} role="group" aria-labelledby={`${sheetTitleId}-tracking`}>
          <span id={`${sheetTitleId}-tracking`} className={styles.sheetGroupLabel}>
            Tracking type
          </span>
          <div className={styles.sheetPills}>
            {LIBRARY_TRACKING_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.pill}
                aria-pressed={tracking === t}
                onClick={() => {
                  onTrackingChange(tracking === t ? '' : t);
                  setShown(PAGE_SIZE);
                }}
              >
                {TRACKING_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.sheetGroup} role="group" aria-labelledby={`${sheetTitleId}-equipment`}>
          <span id={`${sheetTitleId}-equipment`} className={styles.sheetGroupLabel}>
            Equipment
          </span>
          <div className={styles.sheetPills}>
            {EQUIPMENT_CHIPS.map((q) => (
              <button
                key={q}
                type="button"
                className={styles.pill}
                aria-pressed={filters.equipment.includes(q)}
                onClick={() => changeFilters({ ...filters, equipment: toggle(filters.equipment, q) })}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.sheetGroup} role="group" aria-labelledby={`${sheetTitleId}-source`}>
          <span id={`${sheetTitleId}-source`} className={styles.sheetGroupLabel}>
            Show
          </span>
          <div className={styles.sheetPills}>
            <button
              type="button"
              className={styles.pill}
              aria-pressed={filters.customOnly}
              onClick={() => changeFilters({ ...filters, customOnly: !filters.customOnly })}
            >
              Custom only
            </button>
          </div>
        </div>
        {/* Stuck to the bottom of the sheet, so Show N is reachable without scrolling on a small iPhone. */}
        <div className={styles.sheetFooter}>
          <button type="button" className={styles.clear} onClick={clearAll} disabled={inSheet === 0}>
            Clear
          </button>
          <Button className={styles.sheetDone} onClick={() => sheetRef.current?.close()}>
            {data ? `Show ${hits.length} ${hits.length === 1 ? 'exercise' : 'exercises'}` : 'Done'}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
