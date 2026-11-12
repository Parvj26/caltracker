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
 * repeated, or outside 1..weeks are ignored. `added` is ordered by target week, then the source's day, position and
 * id (lowercase uuids compare like Postgres uuids): the order copy_program_week gives the new ids out in. Returns the
 * whole new list plus what was removed and added.
 */
export function copyWeek<T extends PlanSlot>(
  slots: readonly T[],
  { from, to, weeks }: { from: number; to: readonly number[]; weeks: number },
  makeId: () => string,
): { slots: T[]; removed: T[]; added: T[]; weeks: number[] } {
  const targets = [...new Set(to)].filter((w) => Number.isInteger(w) && w >= 1 && w <= weeks && w !== from).sort((a, b) => a - b);
  const source = slots
    .filter((s) => s.week === from)
    .sort((a, b) => a.day - b.day || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const removed = slots.filter((s) => targets.includes(s.week));
  const added = targets.flatMap((week) => source.map((s) => ({ ...s, id: makeId(), week })));
  return { slots: [...slots.filter((s) => !targets.includes(s.week)), ...added], removed, added, weeks: targets };
}

/** One day of a program: week 1..weeks, day 1..7. */
export type PlanCell = { week: number; day: number };

/**
 * "Copy to…" for one workout on the plan: the same workout goes on each chosen day, last in that day, as a new slot
 * (like copyWeek, the copies point at the same workout, so no new workout is made). The source day, repeats and days
 * outside the program are ignored; `targets` is what's left, by week then day, in the order of `added`.
 */
export function copySlotTo<T extends PlanSlot>(
  slots: readonly T[],
  source: T,
  to: readonly PlanCell[],
  weeks: number,
  makeId: () => string,
): { added: T[]; targets: PlanCell[] } {
  const valid = (c: PlanCell) =>
    Number.isInteger(c.week) && Number.isInteger(c.day) && c.week >= 1 && c.week <= weeks && c.day >= 1 && c.day <= 7;
  const seen = new Set<string>();
  const targets = to
    .filter((c) => valid(c) && !(c.week === source.week && c.day === source.day))
    .filter((c) => {
      const key = `${c.week}-${c.day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({ week: c.week, day: c.day }))
    .sort((a, b) => a.week - b.week || a.day - b.day);
  const added = targets.map((c) => {
    const position = slots.reduce((max, s) => (s.week === c.week && s.day === c.day ? Math.max(max, s.position + 1) : max), 0);
    return { ...source, id: makeId(), week: c.week, day: c.day, position };
  });
  return { added, targets };
}
