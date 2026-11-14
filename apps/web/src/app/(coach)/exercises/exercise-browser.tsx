'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import type { ExerciseIndexRow } from '@caltracker/shared';
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
  const [tracking, setTracking] = useState(initialTracking);
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
          initialFilters={{ customOnly: initialSource === 'custom' }}
          rowFilter={rowFilter}
        />
      </div>
    </>
  );
}
