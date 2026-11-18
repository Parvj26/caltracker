import { EQUIPMENT_CHIPS, MUSCLE_CHIPS, type EquipmentChip, type MuscleChip, type SearchFilters } from '@caltracker/shared';
import { rememberUrl } from '@/lib/history-back';

/** The Exercises page's chip filters as kept in the address, so Back, a reload or a shared link shows the same list. */
export type ExerciseUrlFilters = SearchFilters & { favourites: boolean };

const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s))
    .filter((s, i, all) => all.indexOf(s) === i);

/**
 * Reads `?muscle=Chest,Back&equipment=Barbell&custom=1&fav=1` (unknown values are dropped). The older
 * `?source=custom` link still turns Custom only on.
 */
export function readExerciseFilters(params: { get: (name: string) => string | null }): ExerciseUrlFilters {
  return {
    muscles: list<MuscleChip>(params.get('muscle'), MUSCLE_CHIPS),
    equipment: list<EquipmentChip>(params.get('equipment'), EQUIPMENT_CHIPS),
    customOnly: params.get('custom') === '1' || params.get('source') === 'custom',
    favourites: params.get('fav') === '1',
  };
}

/** `href` with the filters written in (empty ones left out), as a path + query + hash. */
export function withExerciseFilters(href: string, f: Partial<ExerciseUrlFilters>): string {
  const url = new URL(href);
  const set = (name: string, value: string) => (value ? url.searchParams.set(name, value) : url.searchParams.delete(name));
  if (f.muscles) set('muscle', f.muscles.join(','));
  if (f.equipment) set('equipment', f.equipment.join(','));
  if (f.customOnly !== undefined) {
    set('custom', f.customOnly ? '1' : '');
    if (url.searchParams.get('source') === 'custom') url.searchParams.delete('source');
  }
  if (f.favourites !== undefined) set('fav', f.favourites ? '1' : '');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Writes the filters to the address without a new history step (a change of view is not a step of its own). */
export function writeExerciseFilters(f: Partial<ExerciseUrlFilters>): void {
  const next = withExerciseFilters(window.location.href, f);
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next);
  }
  rememberUrl();
}
