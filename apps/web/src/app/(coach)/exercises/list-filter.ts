import type { ExerciseIndexRow, SearchFilters } from '@caltracker/shared';

/** Filters the phone list applies after the shared search (which handles muscles, equipment and Custom only). */
export type ListFilter = {
  /** A library tracking type, or '' for any. */
  tracking: string;
  /** ?source=builtin: hide the coach's own exercises. */
  builtinOnly: boolean;
  /** The Favourites chip: only starred exercises. */
  favouritesOnly: boolean;
};

export function matchesListFilter(row: ExerciseIndexRow, f: ListFilter, favourites: ReadonlySet<string>): boolean {
  if (f.tracking && row.trackingType !== f.tracking) return false;
  if (f.builtinOnly && row.source !== 'builtin') return false;
  if (f.favouritesOnly && !favourites.has(row.id)) return false;
  return true;
}

/** How many choices are set inside the Filters sheet (tracking type, equipment, Custom only), for its button. */
export function sheetFilterCount(filters: SearchFilters, tracking: string): number {
  return (tracking ? 1 : 0) + filters.equipment.length + (filters.customOnly ? 1 : 0);
}
