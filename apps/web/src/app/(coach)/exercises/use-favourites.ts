'use client';

import { useCallback, useRef, useState } from 'react';
import type { ErrorCode } from '@caltracker/shared';
import { setFavourite } from '@/app/(coach)/workouts/actions';
import { failureCode } from '@/lib/action-errors';
import { rememberFavourite } from '@/lib/exercise-index';

/**
 * The coach's starred exercises, with a toggle that shows the star at once and undoes it if the save fails. The newest
 * tap on an exercise wins: older answers are ignored. Same behaviour as the builder's picker.
 */
export function useFavourites(initial: Iterable<string>) {
  const [favourites, setFavourites] = useState<Set<string>>(() => new Set(initial));
  const [error, setError] = useState<ErrorCode | null>(null);
  const seqs = useRef(new Map<string, number>());

  const set = useCallback((id: string, on: boolean) => {
    setFavourites((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback(
    async (id: string, want: boolean) => {
      const seq = (seqs.current.get(id) ?? 0) + 1;
      seqs.current.set(id, seq);
      set(id, want);
      rememberFavourite(id, want);
      setError(null);
      let ok = false;
      let code: ErrorCode = 'favourite_save_failed';
      try {
        ok = (await setFavourite(id, want)).ok;
      } catch (e) {
        code = failureCode(e, code);
      }
      if (seqs.current.get(id) !== seq) return;
      if (!ok) {
        rememberFavourite(id, !want);
        set(id, !want);
        setError(code);
      }
    },
    [set],
  );

  /** Replaces the whole set (when the list's data arrives). */
  const reset = useCallback((ids: Iterable<string>) => setFavourites(new Set(ids)), []);

  return { favourites, toggle, error, reset };
}
