/** How many workouts the "Recent" and "Most used" picker sections show. */
export const PICKER_HINT_SIZE = 8;

export type WorkoutHints = { recent: string[]; mostUsed: string[] };

/**
 * The workout picker's shortcuts, from the library workouts a coach put on clients' calendars by hand (newest first,
 * one entry per copy; null when the copy has no source any more).
 * - recent: the last 8 distinct ones still in the library;
 * - mostUsed: up to 8 others used at least twice, most used first (ties: the more recently used first).
 * A workout is never in both.
 */
export function workoutHints(usedNewestFirst: readonly (string | null)[], library: ReadonlySet<string>): WorkoutHints {
  const recent: string[] = [];
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  usedNewestFirst.forEach((id, i) => {
    if (id === null || !library.has(id)) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!firstSeen.has(id)) {
      firstSeen.set(id, i);
      if (recent.length < PICKER_HINT_SIZE) recent.push(id);
    }
  });
  const inRecent = new Set(recent);
  const mostUsed = [...counts.entries()]
    .filter(([id, n]) => n >= 2 && !inRecent.has(id))
    .sort(([a, x], [b, y]) => y - x || firstSeen.get(a)! - firstSeen.get(b)!)
    .slice(0, PICKER_HINT_SIZE)
    .map(([id]) => id);
  return { recent, mostUsed };
}

/** Splits a picker's list into Recent, Most used and the rest (library order), so each workout shows once. */
export function pickerSections<T extends { id: string }>(
  library: readonly T[],
  hints: WorkoutHints,
): { recent: T[]; mostUsed: T[]; rest: T[] } {
  const byId = new Map(library.map((w) => [w.id, w]));
  const pick = (ids: readonly string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const recent = pick(hints.recent);
  const mostUsed = pick(hints.mostUsed.filter((id) => !hints.recent.includes(id)));
  const shown = new Set([...recent, ...mostUsed].map((w) => w.id));
  return { recent, mostUsed, rest: library.filter((w) => !shown.has(w.id)) };
}
