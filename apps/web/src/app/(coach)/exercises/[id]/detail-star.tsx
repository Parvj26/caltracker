'use client';

import { ErrorText } from '@/components/ui';
import { useFavourites } from '../use-favourites';
import styles from '../exercises.module.css';

/** The star in the exercise page's top bar: the same favourite the list and the builder's picker show. */
export function DetailStar({ id, name, initial }: { id: string; name: string; initial: boolean }) {
  const { favourites, toggle, error } = useFavourites(initial ? [id] : []);
  const on = favourites.has(id);
  return (
    <>
      <button type="button" className={styles.topStar} aria-pressed={on} aria-label={`Favourite ${name}`} onClick={() => void toggle(id, !on)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z" />
        </svg>
      </button>
      {error ? <ErrorText code={error} className={styles.topStarError} /> : null}
    </>
  );
}
