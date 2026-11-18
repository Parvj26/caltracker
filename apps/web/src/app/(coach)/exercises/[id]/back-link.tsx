'use client';

import { useSyncExternalStore } from 'react';
import { ParentLink } from '@/components/ui';
import { readListReturn } from '../list-return';

/** ‹ Exercises: back to the list as the coach left it (its search and filters in the address), or the plain list. */
export function BackToExercises() {
  // Read from session storage after hydration (the server renders the plain list link).
  const href = useSyncExternalStore(
    () => () => {},
    () => readListReturn()?.url ?? '/exercises',
    () => '/exercises',
  );
  return <ParentLink href={href} label="Exercises" />;
}
