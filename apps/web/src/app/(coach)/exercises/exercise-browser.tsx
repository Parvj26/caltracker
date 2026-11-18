'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { readExerciseFilters, writeExerciseFilters } from './filter-url';
import { PhoneExerciseList } from './phone-exercise-list';
import { TrackingChips } from './tracking-chips';
import styles from './exercises.module.css';

/** Matches the CSS breakpoint in exercises.module.css: below it the page is the phone list. */
const PHONE_QUERY = '(max-width: 767.98px)';

/** True on a phone, false wider, null before hydration (the server can't know, so neither layout renders yet). */
function usePhone(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    (onChange) => {
      const list = window.matchMedia(PHONE_QUERY);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null,
  );
}

type Props = {
  /** The coach's workspace (from requireCoach). */
  workspaceId: string;
  initialQuery: string;
  /** "custom" starts with the Custom only chip on; "builtin" hides the coach's own exercises. */
  initialSource: '' | 'builtin' | 'custom';
  initialTracking: string;
};

/**
 * The Exercises page body. From 768 px up: the shared list + preview side by side, with the tracking-type chips above.
 * On a phone: a plain list that scrolls with the page, each exercise opening its own page (PhoneExerciseList).
 */
export function ExerciseBrowser({ workspaceId, initialQuery, initialSource, initialTracking }: Props) {
  // From the address first: Back can restore the page from Next's client cache with props from before a chip was
  // picked, while the address still holds ?tracking=.
  const params = useSearchParams();
  const [tracking, setTracking] = useState(params.get('tracking') ?? initialTracking);
  // The chip filters (muscles, equipment, Custom only, Favourites) live in the address too.
  const [urlFilters] = useState(() => readExerciseFilters(params));
  const phone = usePhone();

  const changeTracking = useCallback((next: string) => {
    setTracking(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('tracking', next);
    else url.searchParams.delete('tracking');
    window.history.replaceState(null, '', url);
  }, []);

  const rowFilter = useCallback(
    (row: ExerciseIndexRow) =>
      (!tracking || row.trackingType === tracking) && (initialSource !== 'builtin' || row.source === 'builtin'),
    [tracking, initialSource],
  );

  if (phone === null) return <div className={styles.browsePending} aria-busy="true" />;
  if (phone) {
    return (
      <PhoneExerciseList
        workspaceId={workspaceId}
        initialQuery={initialQuery}
        initialSource={initialSource}
        initialFilters={urlFilters}
        tracking={tracking}
        onTrackingChange={changeTracking}
      />
    );
  }
  return (
    <>
      <TrackingChips value={tracking} onChange={changeTracking} />
      <div className={styles.browse}>
        <SearchPanel
          mode="browse"
          workspaceId={workspaceId}
          initialQuery={initialQuery}
          queryParam="q"
          initialFilters={{ muscles: urlFilters.muscles, equipment: urlFilters.equipment, customOnly: urlFilters.customOnly || initialSource === 'custom' }}
          onFiltersChange={writeExerciseFilters}
          rowFilter={rowFilter}
        />
      </div>
    </>
  );
}
