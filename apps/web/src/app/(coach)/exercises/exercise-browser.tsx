'use client';

import { useCallback, useState } from 'react';
import { SearchPanel } from '@/components/exercise-search/search-panel';
import type { ExerciseIndexRow } from '@caltracker/shared';
import { TrackingChips } from './tracking-chips';
import styles from './exercises.module.css';

type Props = {
  initialQuery: string;
  /** "custom" starts with the Custom only chip on; "builtin" hides the coach's own exercises. */
  initialSource: '' | 'builtin' | 'custom';
  initialTracking: string;
};

/** The Exercises page body: the shared list + preview, plus the tracking-type chips the old page had. */
export function ExerciseBrowser({ initialQuery, initialSource, initialTracking }: Props) {
  const [tracking, setTracking] = useState(initialTracking);

  function changeTracking(next: string) {
    setTracking(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('tracking', next);
    else url.searchParams.delete('tracking');
    window.history.replaceState(null, '', url);
  }

  const rowFilter = useCallback(
    (row: ExerciseIndexRow) =>
      (!tracking || row.trackingType === tracking) && (initialSource !== 'builtin' || row.source === 'builtin'),
    [tracking, initialSource],
  );

  return (
    <>
      <TrackingChips value={tracking} onChange={changeTracking} />
      <div className={styles.browse}>
        <SearchPanel
          mode="browse"
          initialQuery={initialQuery}
          initialFilters={{ customOnly: initialSource === 'custom' }}
          rowFilter={rowFilter}
        />
      </div>
    </>
  );
}
