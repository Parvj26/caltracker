'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { readListReturn } from '../list-return';
import styles from '../exercises.module.css';

/** ‹ Exercises: back to the list as the coach left it (its search and filters in the address), or the plain list. */
export function BackToExercises() {
  // Read from session storage after hydration (the server renders the plain list link).
  const href = useSyncExternalStore(
    () => () => {},
    () => readListReturn()?.url ?? '/exercises',
    () => '/exercises',
  );
  return (
    <Link href={href} className={styles.back} aria-label="Back to exercises">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Exercises
    </Link>
  );
}
