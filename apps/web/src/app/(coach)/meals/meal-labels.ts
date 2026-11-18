/** How often clients logged a shared meal, for its card: "Not logged yet", "Logged 1 time", "Logged 12 times". */
export function loggedLabel(count: number): string {
  if (!Number.isFinite(count) || count < 1) return 'Not logged yet';
  return count === 1 ? 'Logged 1 time' : `Logged ${count} times`;
}

/** The letter on a meal's tile when it has no photo: its first letter or digit, upper case ("?" if it has none). */
export function mealInitial(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name.normalize('NFC'))?.[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** The meals list, with the search text (?q=) the coach had typed, so leaving a meal keeps their search. */
export function mealsListHref(query: string | null | undefined): string {
  const q = (query ?? '').trim();
  return q ? `/meals?q=${encodeURIComponent(q)}` : '/meals';
}

/** The logged count for a list row or the meal's page, or nothing before any client logs it (UI rules §7.4). */
export function loggedNote(count: number): string | null {
  return Number.isFinite(count) && count >= 1 ? loggedLabel(count) : null;
}

/** A meal's own page (read-only), keeping the list's search (?q=). */
export function mealHref(id: string, query: string | null | undefined): string {
  const q = (query ?? '').trim();
  return q ? `/meals/${id}?q=${encodeURIComponent(q)}` : `/meals/${id}`;
}

/** The meal's edit form, keeping the list's search (?q=). */
export function mealEditHref(id: string, query: string | null | undefined): string {
  const q = (query ?? '').trim();
  return q ? `/meals/${id}/edit?q=${encodeURIComponent(q)}` : `/meals/${id}/edit`;
}
