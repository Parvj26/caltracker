/** Most results the Home client search shows. */
export const SEARCH_MAX_RESULTS = 8;

/** Lower case with accents removed, so "jose" finds "José". */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The clients whose "first last" name contains the typed text anywhere (case and accents ignored), in the given
 * order, at most 8. An empty or blank query finds nothing.
 */
export function searchClients<T extends { firstName: string; lastName: string }>(clients: readonly T[], query: string): T[] {
  const needle = foldForSearch(query.trim());
  if (needle === '') return [];
  return clients.filter((c) => foldForSearch(`${c.firstName} ${c.lastName}`).includes(needle)).slice(0, SEARCH_MAX_RESULTS);
}
