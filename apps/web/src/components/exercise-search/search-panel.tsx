'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  buildExerciseIndex,
  searchExercises,
  type ExercisePick,
  type ExerciseIndexRow,
  type SearchFilters,
} from '@caltracker/shared';
import { setFavourite } from '@/app/(coach)/workouts/actions';
import { failureMessage } from '@/lib/action-errors';
import { exerciseImageUrl, loadExerciseDetail, loadExerciseIndex, rememberFavourite, type LoadedExerciseIndex } from '@/lib/exercise-index';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { Button, ErrorText } from '@/components/ui';
import { FilterChips, hasActiveFilters } from './filter-chips';
import { Preview } from './preview';
import { ResultList } from './result-list';
import styles from './exercise-search.module.css';
import { track } from '@/lib/analytics/client';

type Props = {
  mode: 'pick-one' | 'pick-many' | 'browse';
  /** The coach's workspace (from requireCoach): only its custom exercises are listed, beside the built-ins. */
  workspaceId: string;
  onPick?: (exercises: ExercisePick[]) => void;
  /** Pick-many mode: how many must be picked (default 2) and the most that can be (default 10). */
  min?: number;
  max?: number;
  /** Pick-many mode: the line under the search box (default: the superset hint). */
  hint?: string;
  /** Pick-many mode: what the picks become, in the preview's Add to … button (default 'superset'). */
  groupLabel?: string;
  /** Browse mode: open a custom exercise to edit it. */
  onOpen?: (id: string) => void;
  /** Shows a Cancel button in the footer. */
  onCancel?: () => void;
  /** Pick-many mode: an extra control in the footer, before the buttons (the builder's set count). */
  footerExtra?: ReactNode;
  /** Starting search text and chips (the Exercises page fills these from its address). */
  initialQuery?: string;
  initialFilters?: Partial<SearchFilters>;
  /** An extra yes/no test on each row, applied after the search (must be a stable function). */
  rowFilter?: (row: ExerciseIndexRow) => boolean;
};

const PAGE_SIZE = 50;
const NO_FILTERS: SearchFilters = { muscles: [], equipment: [], customOnly: false };

const toPick = (r: ExerciseIndexRow): ExercisePick => ({ id: r.id, name: r.name, trackingType: r.trackingType });

/** Layout A: search box and filter chips on top, a results list on the left, a preview pane on the right. */
export function SearchPanel({
  mode,
  workspaceId,
  onPick,
  min = 2,
  max = 10,
  hint = 'A superset needs 2 or more exercises. Search and tap each one.',
  groupLabel = 'superset',
  onOpen,
  onCancel,
  footerExtra,
  initialQuery = '',
  initialFilters,
  rowFilter,
}: Props) {
  const supabase = useMemo(() => createBrowserSupabase(), []);
  const listId = useId();
  const hintId = useId();
  const baseId = useId();
  const optionId = (id: string) => `${baseId}-${id}`;

  const [data, setData] = useState<LoadedExerciseIndex | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({ ...NO_FILTERS, ...initialFilters });
  const [shown, setShown] = useState(PAGE_SIZE);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<ExercisePick[]>([]);
  const [detail, setDetail] = useState<{ id: string; imagePaths: string[]; instructions: string[] } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [starError, setStarError] = useState<string | null>(null);
  const starSeq = useRef(new Map<string, number>());
  const searchRef = useRef<HTMLInputElement>(null);
  const details = useRef(new Map<string, { imagePaths: string[]; instructions: string[] }>());

  useEffect(() => {
    let stale = false;
    loadExerciseIndex(supabase, workspaceId)
      .then((d) => {
        if (stale) return;
        setData(d);
        setFavourites(new Set(d.favourites));
      })
      .catch(() => {
        if (!stale) setError(true);
      });
    return () => {
      stale = true;
    };
  }, [supabase, workspaceId]);

  const index = useMemo(() => (data ? buildExerciseIndex(data.index) : null), [data]);
  // Ranking uses the favourites as loaded, so starring a row does not make it jump while the coach is looking at it.
  const boosts = useMemo(
    () => ({ favourites: new Set(data?.favourites ?? []), recent: data?.recent ?? [] }),
    [data],
  );
  const hits = useMemo(() => {
    if (!index) return [];
    const found = searchExercises(index, query, filters, boosts);
    return rowFilter ? found.filter((h) => rowFilter(h.row)) : found;
  }, [index, query, filters, boosts, rowFilter]);

  // A search that finds nothing tells us which exercises to add or rename. Wait until typing settles.
  const noHits = index !== null && hits.length === 0;
  useEffect(() => {
    const q = query.trim();
    if (!noHits || q.length < 3) return;
    const timer = setTimeout(() => track('exercise_search_no_results', { query: q }), 1500);
    return () => clearTimeout(timer);
  }, [noHits, query]);

  const activeId = hits.some((h) => h.row.id === highlightId) ? highlightId : hits[0]?.row.id;
  const active = hits.find((h) => h.row.id === activeId)?.row;

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(`${baseId}-${activeId}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, baseId]);

  useEffect(() => {
    if (!activeId) return;
    const cached = details.current.get(activeId);
    if (cached) {
      setDetail({ id: activeId, ...cached });
      return;
    }
    let stale = false;
    loadExerciseDetail(supabase, activeId)
      .then((d) => {
        details.current.set(activeId, d);
        if (!stale) setDetail({ id: activeId, ...d });
      })
      .catch(() => {
        // The preview still shows the first photo and the tags from the index, plus a quiet note.
        if (!stale) setFailedId(activeId);
      });
    return () => {
      stale = true;
    };
  }, [activeId, supabase]);

  const many = mode === 'pick-many';
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const imageUrl = (path: string) => exerciseImageUrl(supabase, path);

  function toggleSelected(row: ExerciseIndexRow) {
    setSelected((cur) =>
      cur.some((s) => s.id === row.id) ? cur.filter((s) => s.id !== row.id) : cur.length >= max ? cur : [...cur, toPick(row)],
    );
  }

  function activate(id: string) {
    setHighlightId(id);
    setPreviewOpen(true);
    const row = hits.find((h) => h.row.id === id)?.row;
    if (many && row) toggleSelected(row);
  }

  function primary(row: ExerciseIndexRow) {
    if (mode === 'pick-one') onPick?.([toPick(row)]);
    else if (many) toggleSelected(row);
    else if (row.source === 'custom') onOpen?.(row.id);
  }

  async function toggleStar(id: string) {
    const want = !favourites.has(id);
    const set = (on: boolean) =>
      setFavourites((cur) => {
        const next = new Set(cur);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    // The newest click for an exercise wins: older answers are ignored, whether they succeed or fail.
    const seq = (starSeq.current.get(id) ?? 0) + 1;
    starSeq.current.set(id, seq);
    const before = !want;
    set(want);
    // Update the shared cache now, so a picker reopened before the save finishes already shows the star.
    rememberFavourite(id, want);
    setStarError(null);
    let ok = false;
    let message = "Couldn't save favourite. Try again.";
    try {
      ok = (await setFavourite(id, want)).ok;
    } catch (e) {
      message = failureMessage(e, message);
    }
    if (starSeq.current.get(id) !== seq) return;
    if (!ok) {
      rememberFavourite(id, before);
      set(before);
      setStarError(message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const visible = hits.slice(0, shown);
      const at = visible.findIndex((h) => h.row.id === activeId);
      const next = visible[Math.min(visible.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setHighlightId(next.row.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) primary(active);
    }
  }

  function changeFilters(next: SearchFilters) {
    setFilters(next);
    setShown(PAGE_SIZE);
  }

  const action = !active
    ? null
    : mode === 'pick-one'
      ? { label: 'Add to workout', onClick: () => primary(active) }
      : many
        ? { label: selectedIds.has(active.id) ? `Remove from ${groupLabel}` : `Add to ${groupLabel}`, onClick: () => primary(active) }
        : active.source === 'custom'
          ? onOpen
            ? { label: 'Edit', onClick: () => primary(active) }
            : { label: 'Edit', href: `/exercises/${active.id}` }
          : // Built-ins have no Edit, but their page holds the pinned video and coaching notes.
            { label: 'Details', href: `/exercises/${active.id}` };

  return (
    <div className={styles.panel}>
      <label className={styles.searchLabel}>
        <span>Search exercises</span>
        <input
          type="text"
          ref={searchRef}
          role="combobox"
          // The list is always shown beside the box (never collapsed), so the combobox is always expanded.
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId ? optionId(activeId) : undefined}
          aria-describedby={many ? hintId : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={styles.input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE_SIZE);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {many ? (
        <p id={hintId} className={styles.caption}>
          {hint}
          {selected.length >= max ? ` You can pick at most ${max}.` : ''}
        </p>
      ) : null}
      <FilterChips filters={filters} onChange={changeFilters} />
      {many ? (
        // Always mounted, so screen readers hear each pick as it is added.
        <div aria-live="polite">
          {selected.length > 0 ? (
            <ol className={styles.picked} aria-label="Picked, in the order they're done">
              {selected.map((ex) => (
                <li key={ex.id}>
                  {ex.name}
                  <button
                    type="button"
                    className={styles.pickedRemove}
                    aria-label={`Remove ${ex.name}`}
                    onClick={() => setSelected((cur) => cur.filter((s) => s.id !== ex.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {error ? <ErrorText>Couldn&apos;t load exercises. Please try again.</ErrorText> : null}
      {starError ? <ErrorText>{starError}</ErrorText> : null}

      <div className={styles.split} data-preview={previewOpen || undefined}>
        <div className={styles.listPane} aria-busy={!data && !error}>
          {data && hits.length === 0 ? (
            <div className={styles.empty}>
              <p>No exercises match &quot;{query.trim()}&quot;</p>
              <div className={styles.emptyActions}>
                {hasActiveFilters(filters) ? (
                  <Button variant="secondary" onClick={() => changeFilters(NO_FILTERS)}>Clear filters</Button>
                ) : null}
                <Link href="/exercises/new" className={styles.link} target="_blank">Create a custom exercise</Link>
              </div>
            </div>
          ) : (
            <ResultList
              listId={listId}
              hits={hits}
              shown={shown}
              activeId={activeId}
              selectedIds={many ? selectedIds : null}
              favourites={favourites}
              imageUrl={imageUrl}
              optionId={optionId}
              onActivate={activate}
              onToggleFavourite={(id) => void toggleStar(id)}
              onShowMore={() => setShown((n) => n + PAGE_SIZE)}
            />
          )}
        </div>
        <section className={styles.previewPane} aria-label="Exercise preview">
          {active ? (
            <Preview
              key={active.id}
              row={active}
              detail={detail?.id === active.id ? detail : null}
              imageUrl={imageUrl}
              action={action}
              detailFailed={failedId === active.id}
              onBack={() => {
                setPreviewOpen(false);
                searchRef.current?.focus();
              }}
            />
          ) : (
            <p className={styles.caption}>Pick an exercise to see photos and instructions.</p>
          )}
        </section>
      </div>

      {onCancel || many ? (
        <div className={styles.footer}>
          {many ? footerExtra : null}
          {onCancel ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
          {many ? (
            <Button disabled={selected.length < min} onClick={() => onPick?.(selected)}>
              {selected.length < min
                ? `Pick at least ${min} ${min === 1 ? 'exercise' : 'exercises'}`
                : `Add ${selected.length} ${selected.length === 1 ? 'exercise' : 'exercises'}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
