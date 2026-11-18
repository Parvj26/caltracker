'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { rememberUrl } from './history-back';

// Screen choices (a filter chip, a sort, a picked day, a chart range) kept in the address, so Back, a reload or a
// shared link comes back to the same view. Written with history.replaceState: a change of view is not a step of its
// own, so Back still leaves the page in one go. Next's router follows replaceState, so useSearchParams sees it.

/** The address's value when it is one of `allowed`, else `fallback` (missing, or an old or hand-edited link). */
export function pickParam<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** `href` with `name` set to `value` (left out when it is the default), as a path + query + hash. */
export function withParam(href: string, name: string, value: string, fallback: string): string {
  const url = new URL(href);
  if (value === fallback) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Writes one address value without a new history entry. The state passed is null on purpose: Next copies its own
 * history state over, and only then tells useSearchParams (passing Next's state back in skips that).
 */
export function replaceParam(name: string, value: string, fallback: string): void {
  const next = withParam(window.location.href, name, value, fallback);
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next);
  }
  rememberUrl();
}

/** One choice of a fixed set, read from and written to `?name=`. */
export function useUrlChoice<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (value: T) => void] {
  const params = useSearchParams();
  const value = pickParam(params.get(name), allowed, fallback);
  const set = useCallback((v: T) => replaceParam(name, v, fallback), [name, fallback]);
  return [value, set];
}
