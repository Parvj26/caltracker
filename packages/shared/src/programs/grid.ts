/** One workout on a program day, as the program grid holds it. */
export type PlanSlot = { id: string; week: number; day: number; position: number; workoutId: string };

/** The weeks after `week`, up to the program's last week: the targets of "Repeat week N for the following weeks". */
export function followingWeeks(week: number, weeks: number): number[] {
  return Array.from({ length: Math.max(0, weeks - week) }, (_, i) => week + 1 + i);
}

/** How many workouts sit in these weeks: what copying onto them would replace. */
export function slotsInWeeks(slots: readonly PlanSlot[], weeks: readonly number[]): number {
  return slots.filter((s) => weeks.includes(s.week)).length;
}

/**
 * Copies one week onto other weeks, replacing what they held: each target week ends up with exactly the source
 * week's workouts, on the same days and in the same order, as new slots. Replacing (not merging) is what a coach
 * expects from "copy week 1 to week 2": afterwards the two weeks look the same. Targets that are the source week,
 * repeated, or outside 1..weeks are ignored. Returns the whole new list plus what was removed and added.
 */
export function copyWeek<T extends PlanSlot>(
  slots: readonly T[],
  { from, to, weeks }: { from: number; to: readonly number[]; weeks: number },
  makeId: () => string,
): { slots: T[]; removed: T[]; added: T[]; weeks: number[] } {
  const targets = [...new Set(to)].filter((w) => Number.isInteger(w) && w >= 1 && w <= weeks && w !== from).sort((a, b) => a - b);
  const source = slots
    .filter((s) => s.week === from)
    .sort((a, b) => a.day - b.day || a.position - b.position || a.id.localeCompare(b.id));
  const removed = slots.filter((s) => targets.includes(s.week));
  const added = targets.flatMap((week) => source.map((s) => ({ ...s, id: makeId(), week })));
  return { slots: [...slots.filter((s) => !targets.includes(s.week)), ...added], removed, added, weeks: targets };
}
