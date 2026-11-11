import { buildSmartIndex, smartMatch } from '../search/smart-search';

/** Most results the Home client search shows. */
export const SEARCH_MAX_RESULTS = 8;

/** Lower case with accents removed, so "jose" finds "José". */
export function foldForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * The clients matching the typed text with the shared smart search (typos in longer words, partial words, any word
 * order, case and accents ignored), best match first (whole name, then starts-with, then the rest, then typos), the
 * given order within a tier, at most 8. An empty or blank query finds nothing.
 */
export function searchClients<T extends { firstName: string; lastName: string }>(clients: readonly T[], query: string): T[] {
  const index = buildSmartIndex(clients, (c) => ({ name: `${c.firstName} ${c.lastName}`.trim() }));
  // smartMatch keeps the given order, and sort is stable, so ties stay in the caller's order.
  return smartMatch(index, query)
    .sort((a, b) => a.tier - b.tier)
    .slice(0, SEARCH_MAX_RESULTS)
    .map((h) => h.item);
}
