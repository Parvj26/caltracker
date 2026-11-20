import { normalizeSearchText } from '../search/smart-search';

/**
 * Creating an exercise from a search that found nothing. Pure.
 *
 * Two kinds of "same name":
 * - sameExerciseName: the server refuses these (case and spacing ignored: "Sandbag  carry" = "Sandbag Carry").
 * - findNearDuplicate: the form only asks "Did you mean …?" (the shared smart search's normalising, so case, accents,
 *   punctuation and all spaces are ignored: "sand bag carry" ~ "Sandbag Carry", "T-Bar Row" ~ "t bar row").
 */

/** The name as the server compares it: trimmed, inner runs of spaces as one, lower case. */
export function exerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function sameExerciseName(a: string, b: string): boolean {
  return exerciseNameKey(a) === exerciseNameKey(b);
}

/** The name with case, accents, punctuation and every space taken out ("Sand-bag Carry" -> "sandbagcarry"). */
export function compactExerciseName(name: string): string {
  return normalizeSearchText(name).replace(/ /g, '');
}

/** The first of `rows` whose name is near-identical to `name` (see compactExerciseName), or null. */
export function findNearDuplicate<T extends { name: string }>(name: string, rows: readonly T[]): T | null {
  const key = compactExerciseName(name);
  if (key === '') return null;
  return rows.find((r) => compactExerciseName(r.name) === key) ?? null;
}
