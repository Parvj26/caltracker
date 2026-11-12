/** The program grid's days, labels and DOM ids, so focus can land somewhere sensible after a chip moves. */
export const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Matches the grid's own column headers ("Day N"): a program can start on any weekday, so no weekday names. */
export const copyDaySuffix = (week: number, day: number) => ` (Week ${week}, Day ${day})`;
export const cellLabel = (week: number, day: number) => `Week ${week}, Day ${day}`;
/** "Week 1, Day 3 and Week 2, Day 5": the days a copy went to. */
export const cellsLabel = (cells: readonly { week: number; day: number }[]) => {
  const labels = cells.map((c) => cellLabel(c.week, c.day));
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join('; ')} and ${labels[labels.length - 1]}`;
};
export const chipDomId = (slotId: string) => `program-chip-${slotId}`;
export const focusSoon = (domId: string) => requestAnimationFrame(() => document.getElementById(domId)?.focus());
export const libraryItemDomId = (workoutId: string) => `program-library-${workoutId}`;
export const copyWeekButtonDomId = (week: number) => `program-copy-week-${week}`;
/**
 * What a program change does to clients already on it: with Live Sync off, assigning copied the workouts and later
 * changes don't reach them; with it on, their untouched upcoming workouts follow.
 */
export const assignedNote = (live: boolean) =>
  live
    ? 'Live Sync is on: clients on this program get this change from today on.'
    : 'Clients already on this program keep their current workouts.';
/** Shown on a program just made with "Duplicate": the copy points at the same library workouts. */
export const DUPLICATE_NOTE = 'Workouts are shared with the original — editing a workout changes both.';
